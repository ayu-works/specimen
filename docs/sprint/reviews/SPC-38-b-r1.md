# SPC-38 lens B review, round 1

Reviewer: fresh lens-B reviewer · PR #46 (`exec/spc-38` on `exec/spc-44`) · 2026-10-17
Read: setup.md (sprint/log), SPC-38 + both comments, handoff `SPC-38.md`, `gh pr diff 46`, plus `Scan.tsx`, `store.ts`,
`runScan.ts`, `useShortcut.ts`, `restore.ts`, `App.tsx`, `Generate.tsx`, `Inspect/index.tsx`, `lib/scanFlow.ts`.

**Verdict: changes requested.** 0 CRITICAL · 1 HIGH · 2 MEDIUM · 4 LOW.

The Scan-tab fix works and is tested end to end through the real `runTabScan` and `<Scan />`. The main gap is that the
same misleading success still happens in the one flow where the user never sees the Scan tab.

---

## HIGH

### H1. Alt+Shift+C: a failed scan shows the previous scan's prompt on Generate, with no alert and no label
`useShortcut.ts:26-27` calls `setTab('generate')` and then `await runTabScan()`. When that scan fails, `fail()` sets
`status: 'error'` and keeps `scan`, so the panel stays on **Generate** and shows the previous scan's prompt. The alert and
the new label exist only in `Scan.tsx`, which isn't mounted on that tab. `Generate.tsx` reads `status` only for the
`!scan && scanning` spinner. The header (`App.tsx:170`) still shows the old host.

**Scenario:** scan stripe.com. Move to a `chrome://settings` tab (or a page whose scan times out, or a closed tab) and
press Alt+Shift+C. The panel shows Generate with stripe.com's prompt and a Copy button. Nothing says the scan failed, so
the user copies stripe's prompt as "this page". This is the exact bug SPC-38 is about, in the flow built for "scan and
give me the prompt". With no previous scan it fails silently too: Generate says "Scan a page first", and the error is
never shown.

**Fix (pick one, smallest first):**
- In `useShortcut.consume`, after `await runTabScan()`: `if (useStore.getState().status === 'error') setTab('scan');`.
  Then the alert and the label from this PR are what the user sees.
- Or put a short stale banner on Generate (and Inspect) when `status === 'error' && scan`, e.g. "The last scan failed.
  This is your previous scan (stripe.com)." with a link back to Scan.

Add a T1.37 (or shortcut-test) case: a scan succeeds, then the shortcut path fails, then assert the user can see the
failure (the active tab is `scan`, or Generate shows the banner).

---

## MEDIUM

### M1. The label is the faintest text on the card: easy to miss, worst in dark theme
The label is `text-xs font-medium` in the default foreground, inside a card set to `opacity-70`. So the label is dimmed
along with everything else. It has no color, icon or border, and it's smaller than the host line right under it
(`font-medium`, normal size). In dark theme, 70% opacity on a dark card cuts contrast further. The eye goes to the
favicon, host and thumbnail, which look like a normal result, a bit greyed. The red alert is above the card, but on a
narrow panel with a tall thumbnail, and after scrolling down to Generate prompt, the alert is off screen and only this
faint line is left.

**Fix:** keep the label at full opacity and make it stand out. Put it outside the dimmed part (apply `opacity-70` to a
wrapper around the card's content, not to the label), and style it as a warning chip or banner: for example
`rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive`, or the existing `Badge` with an icon.
Check contrast in both themes, at 320px panel width.

### M2. The stale card's actions don't say which scan they act on (screen readers, keyboard)
`role="note"` isn't announced when it appears, and it isn't on the path a screen-reader user takes by Tab key or buttons
list. The buttons read "Generate prompt", "Inspect", "Add another page" and "Try again" (mobile), with no stale context.
The alert's "The card below is your previous scan." is announced once, when it appears. A user who comes back to the
panel later, or who navigates by buttons, gets "Generate prompt" with nothing tying it to stripe.com.
"Add another page" on the stale card merges the current tab into the **previous** scan (pinned in test 2). That's
right when the tab is on the same host, but the user has just been told "not this page", so the button reads as if it
adds the page they are on now.

**Fix:** give the card an accessible name while it's stale: `aria-label` / `aria-describedby` pointing at the label, or
`<section aria-labelledby>` with the label text "Previous scan of stripe.com". Optionally rename "Generate prompt" to
"Generate prompt (previous scan)" while stale. Low cost, and it also covers sighted users who scroll.

---

## LOW

### L1. Missing period: "Scan failed: Could not open a tab The card below is your previous scan."
`friendlyScanError` falls through to `` `Scan failed: ${msg}` `` for unknown errors. Raw messages often have no final
period (e.g. `'Could not open a tab'`, `scanFlow.ts:181`, or Chrome's own errors). `Scan.tsx:258` appends
`' The card below…'` with no separator, so the alert runs the two sentences together. SPC-20's own texts are intact and
all end in a period, so only the fallback is affected.
**Fix:** render the sentence as its own element (`<span className="block">`), or add a period when `error` doesn't
end in `.`/`!`/`?`. Add a test with an unmapped error.

### L2. "not this page" can be false after a tab switch
"This page" means the active browser tab, and the label doesn't follow it. Scan stripe.com, fail on `chrome://settings`,
then switch back to the stripe.com tab: the card says "Previous scan, not this page." while it is this page. It's minor
and errs the safe way, but the wording is what users read.
**Fix:** word it so it doesn't depend on the tab: "Previous scan: stripe.com. The last scan failed." (the host is
already there).

### L3. The alert text and the button text don't match
SITE_ACCESS says "Click Scan again and choose Allow", and the worker error says "Click Scan again." The stale card's
button now reads "Scan this page", and the empty state also says "Scan this page". This is cosmetic, but a user looks
for a "Scan" button and finds the label they were told about only roughly. Not a blocker. Note it for SPC-20's texts,
or say "Click Scan this page".

### L4. Tests: the failure path is only `chrome://`, and nothing covers a tab other than Scan
Every stale-card test fails at the `Unsupported page` check in `runTabScan`, before `scanTab` and the background run. That
is a real path (not a stubbed store), but the plan also listed "or the background rejects". One case where
`sendMessage` resolves `{ ok: false, error: '…took too long to load…' }` after a success would pin the more common
real-world failure, and SPC-20's timeout text with the appended sentence. H1's test covers the "different tab" gap.

---

## Checked and fine
- **Retry that works:** `start()` clears `error`. `succeed()` sets `done` with a new id. The label and alert go away,
  and the card shows the new host (test 3). While it runs there's no label (test 4).
- **Two failures in a row:** `start()` unmounts the alert and `fail()` remounts it, so it's announced again and the
  label stays. Correct.
- **No previous scan:** the alert alone, empty state, no "card below" sentence (test 5).
- **Save error (#33) vs scan error:** a scan whose save fails is `done` with `saveError`, so there's no label. A stale
  card keeps its "Not saved to Library" line (test 6). The two lines don't contradict each other.
- **Panel reopen (SPC-26):** `status`/`error` aren't stored in the memo. `restorePanel` reattaches the memo scan only
  when its URL matches the live tab, through `openScan` (`done`), so a reopen on the failed page opens empty, and a
  reopen on the old page shows it unlabelled, correctly. There's no stale claim either way.
- **Library open after a failure:** `openScan` clears it (test 7).
- **Derived state:** `stale` is computed from `status` and `scan` at render, so there's no drift.
