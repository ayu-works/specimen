# SPC-45 handoff: rescanUrl leaves its tab open when the load times out

Executor session `spc-45-2d`, branch `exec/spc-45` (from origin/exec/spc-44, stacked on #43 → #39). PE: `pe-b2`.
Orchestrator: `specimen-5c` (was `specimen-75`).

## Plan (APPROVED by pe-b2, 2026-10-17, with notes a-c below)

### What is wrong
`rescanUrl` (`apps/extension/src/lib/scanFlow.ts`) opens a foreground tab with `chrome.tabs.create`, waits with
`waitForTabLoad`, sleeps 800 ms, and scans. If the wait, the sleep or the scan throws, the tab it opened stays open,
so repeated failed re-scans leave extra tabs. Also (SPC-28 lens B L2, the "Sprint plan overrides" comment): a heavy page
whose navigation has committed but that is still `loading` at 30 s (a slow ad or iframe) fails with "took too long",
even though the user can see it.

### Decision for a page still loading at the limit: **scan what's there** (re-scan only)
At the timeout, if the last state we saw for the tab shows the navigation **committed to a page we can see**
(`!pendingUrl`, `url` set and not `about:blank`), `waitForTabLoad` resolves and the scan goes ahead. Otherwise
(still pending, blank, or url hidden so we can't tell) it rejects with "The page took too long to load", as today.
- Why: `complete` waits for every subresource and iframe. After 30 s with the document committed, the DOM and its
  stylesheets are almost always there, and the measurement is of what the user sees. Failing such a page is a false
  failure. If the page is truly broken, the scan's own errors (error page, no sampler result) still say so.
- Opt-in: a new `TabLoadOptions.scanIfCommitted` (default off). Only `rescanUrl` sets it. Mobile capture
  (`captureFlow.ts`) keeps failing at the limit, unchanged (its "Mobile capture skipped" note is the right outcome there,
  and I'm not touching captureFlow).
- "Last state seen" is the most recent `tabs.get` answer or `onUpdated` tab argument (reads run every 500 ms, so it's
  ≤ 0.5 s old). No extra read at the timeout, so the timeout stays a hard bound.

### Closing the tab
```ts
const tab = await chrome.tabs.create({ url, active: true });
const id = tab.id;
if (id === undefined) throw new Error('Could not open a tab');   // nothing we can close
try {
  …wait, settle, scan…
  return result;            // success: the tab stays open, as today (the user re-scanned to see the site)
} catch (e) {
  await closeOwnTab(id);    // every failure path: timeout, tab closed, load error, scan error, get error
  throw e;                  // the original error, never one from cleanup
}
```
`closeOwnTab(id)` = `chrome.tabs.remove(id)` wrapped so **any** error (sync throw or rejection: "No tab with id" when
the user or Chrome already closed it, or anything else) is swallowed. Cleanup must never replace the error the user
needs to see. (`catch` + rethrow instead of `finally` + flag: same effect, one fewer variable.)
A `saveError` (Library save failed) is a successful scan, so the tab stays open.

### Files
- `apps/extension/src/lib/scanFlow.ts`: `rescanUrl` (close on failure), `waitForTabLoad` (`scanIfCommitted`,
  remember the last state). No change to `friendlyScanError`, `scanTab`/`saveError` (SPC-20) or the SPC-28 race logic.
- `apps/extension/test/rescanUrl.test.ts` (new): its own `chrome.tabs` stub via `vi.stubGlobal`; `vi.mock` of
  `../src/lib/messaging` (`send`) and `../src/lib/db` (`saveScan`), and `extract`. `test/helpers/chrome.ts` NOT edited (#40).
- `apps/extension/test/waitForTabLoad.test.ts`: two T5.12 cases for the timeout option.
- `docs/TESTING.md`: new row **T5.14** (U). T5.13 is SPC-44's; no open PR uses T5.14 (checked all open branches).
- Not touched: Scan.tsx, Generate.tsx, Byok.tsx, packages/ai, test/helpers/chrome.ts, captureFlow.ts, Library view.

### Tests (fake timers, stubbed chrome; no real tabs, no network)
T5.14 `rescanUrl`:
1. Timeout, navigation never committed (`pendingUrl` stays): rejects "took too long"; `tabs.remove` called **once**
   with our id; `scan.run` never sent.
2. Timeout, page committed but `loading`: resolves with the scan; `scan.run` sent for our id; `remove` not called.
3. The tab is closed while loading (`onRemoved`): rejects "The tab was closed"; `remove` is called, rejects
   "No tab with id", and that is swallowed (the caller sees "The tab was closed").
4. Scan error (`send` rejects): rejects with that error; `remove` called once.
5. `remove` itself throws synchronously or rejects with some other error: the original error still comes through.
6. Success: resolves with scan + favicon; `remove` never called (the tab is left for the user).
7. `create` returns no id: rejects "Could not open a tab"; `remove` never called.
8. Only our id: with another tab's events firing, `remove` is only ever called with the id `create` returned.
T5.12 additions (`waitForTabLoad`):
9. Default options: a committed-but-loading page at the timeout still rejects (mobile capture unchanged).
10. `scanIfCommitted` with a hidden url / visible `about:blank` / `pendingUrl` at the limit: rejects.

### Failure modes
- **Partial failure / cleanup errors:** cleanup is best-effort and swallowed; the original error always wins (test 5).
- **Idempotency:** one `remove` per failed re-scan (tests 1, 4); a tab already gone is fine (test 3).
- **Never close a user's tab:** we only remove the id that our own `tabs.create` returned. Never a query, never the
  active tab. Residual risk (accepted, noted in the PR): the tab is in the foreground, so if the user navigates *our*
  tab elsewhere during the ≤ 30 s wait and the re-scan then fails, we close it. It's still the tab we opened for the
  re-scan, and the panel shows the error.
- **Misleading success (scan-what's-there):** a page committed but missing late CSS could be scanned partly. Bounded to
  pages that have been committed for most of 30 s; the result is a normal scan that can be re-scanned. Only re-scan
  opts in.
- **Concurrency:** two re-scans each close only their own id. The SPC-28 settle-once logic is unchanged, and the
  timeout path still goes through `done()`, so no listener, timer or read is left either way.
- **Not covered (accepted):** the side panel closing mid-re-scan kills its JS, so no cleanup runs and the tab stays.
  A prerender `onReplaced` swaps the tab id: the old id is gone ("The tab was closed") and the new tab isn't ours to
  know, so it stays. Both are rare and existing behaviour.
- **Drift:** the timeout sentence and its `friendlyScanError` mapping are unchanged; one source.

### Check
`pnpm gate` green. Owner manual test in the PR body: re-scan a Library card whose URL hangs (e.g. a local server that
never finishes the response) → error shown after ~30 s, no extra tab; re-scan an unreachable host → error, no extra
tab; a normal re-scan → the tab stays open with the site.

PE notes (folded): (a) the `scanIfCommitted` resolve goes through `done()`; its test asserts no listener left and no
read after it. (b) The last state also updates from the `onUpdated` tab argument, for our id only (another tab's
committed event can't satisfy it, tested). (c) The accepted residuals go in the PR body.

## Done (2026-10-17)
- `scanFlow.ts`: `closeOwnTab` + catch/rethrow in `rescanUrl`; `TabLoadOptions.scanIfCommitted` + `last` state in
  `waitForTabLoad`. `test/rescanUrl.test.ts` (9 × T5.14), 3 new T5.12 cases, TESTING.md T5.14.
- With the old `scanFlow.ts`, 8 of the new tests fail (6 × T5.14, 2 × T5.12); the other 4 pin behaviour that already
  held (success / save error / no id leave the tab, and the default timeout still rejects). All pass on the new code.
- `pnpm gate` green locally (gitleaks not installed locally: skipped, CI runs it). 325 extension unit tests, 55 e2e.

## Next / how to resume
- PR is open against exec/spc-44; fold in review files from `docs/sprint/reviews/SPC-45-*.md` with new commits.
- 2026-10-17: PR #48 open. Lens A r1 (pe-b2): APPROVED, 0 findings, committed. CI reports no checks on this branch
  (the PR's base is exec/spc-44, not main). Waiting for lens B.
