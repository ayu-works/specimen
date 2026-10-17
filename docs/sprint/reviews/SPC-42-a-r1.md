# SPC-42 lens A r1 (PE pe-b2, 2026-10-17)

PR #53 @ e4dd47f, base `exec/spc-41`: `askHistory.ts` (new), `Ask.tsx`, `ask.test.tsx`, `askHistory.test.ts`, and the T3.12 row.
8/8 green here.

**Verdict: APPROVED. 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW.**

## Checks
- **A stopped answer is never replayed:** the catch marks `error: STOPPED_TEXT` whenever `ctl.signal.aborted`, whatever
  error shape the abort surfaced as. A local `ctl` (not the module `controller`) means a newer question can't change
  how an older one is classified. The only abort is the Stop button (Ask.tsx:189). A Stop that races a normal end
  resolves first and stays whole. Persisting through the existing `ChatMessage.error` field means no stored-shape
  change and no migration.
- **Whole pairs only:** `askHistory` keeps a user turn only when the next message is an assistant reply with content
  and no error, then skips past the pair. Errored, stopped, empty and trailing unanswered turns drop their question,
  so the model never sees two user turns in a row (unit-tested).
- **Render:** a stopped line is muted with no sad mascot, and real errors keep the destructive style. A Stop before
  the first delta shows "Stopped." instead of an endless "…".
- Old transcripts saved before this fix can't be told apart. That's accepted, as the plan says.
