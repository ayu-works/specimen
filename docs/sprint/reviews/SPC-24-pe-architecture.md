# SPC-24 Council v2: background-run architecture (PE decision, 2026-10-15)

Written before the executor's plan so the plan can build on it. The plan may argue against any point with a reason.
Everything SPC-22 guaranteed still holds: the cap, Groq pacing and retries, the sanitizer on every turn and the
verdict, the Labs flag off by default, mock-only tests, no `site/` change, no `DesignScan` change.

## 1. Where the run lives: the offscreen document, main thread (not the service worker)
- **Not the service worker.** An MV3 service worker is stopped after about 30 s without events. Timers don't keep it
  alive, and a slow fetch can be cut off. Our pacing and retry waits are 20–60 s of silence, so a SW-hosted run would
  die mid-run, losing its in-memory state. Keep-alive pings would be a hack. No.
- **The offscreen document.** It already exists for WebLLM (`ensureOffscreen` in `background.ts`, reason
  `WORKERS`), and nothing ever closes it. A non-audio offscreen document has no lifetime limit and survives the side
  panel closing. Add `offscreen/councilHost.ts` next to `llmHost.ts`, using the same Port pattern.
  - Keep the single reason `WORKERS` (ARCHITECTURE §11): the document's reason to exist is unchanged. Update the
    justification string to mention the council only if the owner wants it.
  - No new permission. `fetch` from the offscreen page uses the same extension origin and the same optional host
    permission that BYOK already requests.
  - Hidden-page timers: Chrome throttles chained timers in hidden pages. Our timers are single waits, not chains,
    but the plan should say so. A test can't see this, so it goes in T3.27's owner check (close the panel during a
    pacing wait).
- **Provider in the host.**
  - BYOK (openaiCompat/anthropic/gemini) is built in the host from a config sent in `start`.
  - WebLLM goes through the existing `llmHost` queue in the same document (never a second engine). Audit H1 (an
    abort truncating a concurrent Ask) stays a known limitation, tracked in SPC-18.
  - Chrome built-in may not exist in an offscreen page: then the council says it needs another provider (graceful,
    tested).

## 2. Keys
- The offscreen page can't read `chrome.storage`. The panel, which has the resolved and unlocked config, sends it
  in `start` over the runtime Port. The key lives only in the host's memory for that run and is dropped when the run
  ends.
- **Never** in the stored run record, a Port message back to any panel, a log, or an error. Test: serialize every
  message the host sends plus the stored record, and assert the fake key never appears.

## 3. State, verdict, reattach
- **Storage:** IndexedDB, written by the host (same extension origin as the panel), in a **separate database**
  (`specimen-council`). Don't bump the main Dexie DB: no migration risk to users' scans or chats.
- **Record:** `{ runId, scanId, status, plan, context, turns, verdict, startedAt, updatedAt }`. Write it once per
  turn end and per status change, each as one atomic `put`. Keep the last 5 runs, pruned in the same transaction.
- **Live updates:** over a Port (`council`). On attach, the host sends the current snapshot, then deltas.
- **Reattach:** the panel opens, reads the latest record and, if it's `running`, connects the Port.
  - The host replies with the live run.
  - If no host answers, or the runId is unknown (the document died: crash, extension reload or update, browser
    restart), the panel marks the record `interrupted` so the mascot never thinks forever.
  - The SW also marks `running` records `interrupted` in `onStartup`/`onInstalled`. Test both.
- **One run at a time, per extension, not per panel.** `start` while a run is live returns the live run (no second
  run). Two windows' panels both attach to the same run.

## 4. Abort and guards (no panel needed)
- **Stop:** from any panel → Port `stop{runId}` → that run's AbortController. All SPC-22 abort paths still hold:
  quiet stream end, pacing wait, retry wait, stall.
- **Closing the panel does not stop the run** (the point of v2). Leaving the scan doesn't stop it either: the run
  holds its own copy of the scan, sent in `start`.
- **Flag off and provider/key change:** the SW watches `storage.onChanged`, which wakes it, for `flags.critique`, the
  AI settings and the secrets/session keys, and sends `stop` to the host. This replaces the panel-side
  `guardProvider` and flag reset, which can't work with the panel closed. Test with fake chrome events.

## 5. Done signal
- On done, error or interrupted, the host sends a runtime message. The SW sets a toolbar badge (`setBadgeText`,
  no permission needed). **Badge: yes.** With the panel closed it's the only visible signal. Clear it when a panel
  shows the verdict.
- The mascot: `thinking` while `running`, `ready` when done. A click opens the verdict view.

## 6. Contract I'm freezing (send it in the plan; versioned `v: 1`)
- **Panel → host:** `start{ v, runId, scan, provider: {kind, cfg}, personas, rounds, context }` · `stop{ runId }` ·
  `attach{}`.
- **Host → panel:** `snapshot{ record-without-key }` · `turn{ runId, index, turn }` ·
  `status{ runId, status, verdict?, error? }`.
- **Host → SW:** `council.finished{ runId, status }`.
- Unknown `v` or malformed → rejected with a fixed error, never thrown into the host.

## 7. Report and context
- **Context box:** user text, clipped (e.g. 1000 chars). It's in every turn as `[Goal]:` outside `<page_data>`, and
  stored in the record (the user's own text).
- **Verdict:** sanitized, with lenient parsing (verdict / works / change / disagreements); the fallback is the raw
  sanitized text. No generated prompt. "Show discussion" collapsed by default.

## Failure modes the plan must test (mock only)
Panel closed mid-run → the run finishes and the record is `done`. Host gone → `interrupted` on attach and on SW
start. Two attaches → one run. Stop with no panel open (from the SW guard). A key change mid-run → stop, no further
calls to the old provider. No key anywhere outside the host's memory. Prune leaves exactly 5. Badge set on finish
and cleared on view.
