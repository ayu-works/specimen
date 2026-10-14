# SPC-7 lens A review, round 2 (PE, 2026-10-14)

Commits 749eb35, ab53ae3 and c2e356e, reviewed as the diff from 8ab50e1.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 0 LOW. Lens A approves.**

- **L1 fixed:** `test` is in the video tsconfig include.
- **L2 fixed:** the last scene is asserted to run at least 4 × BEAT (one bar), and the tautology is gone.
- **L3:** the Root.tsx edit is acknowledged. It's comment only (749eb35), done in the PR at the orchestrator's request,
  and the new text matches the 12 compositions.
- **Lens-B fixes:**
  - **calculateMetadata:** a composition that has it is flagged, because its static props would no longer be what
    renders. The failure case asserts the exact message.
  - **registerRoot:** `src/index.ts` must register the same Root the test walks, checked with a mocked `registerRoot`.
  - **CI changed-guard:** it now also triggers on root `package.json`, `tsconfig.base.json` and ci.yml. If the base
    sha can't be resolved, `git diff` errors, and the guard then runs the job rather than skipping it, which is the
    right side to fail on.
