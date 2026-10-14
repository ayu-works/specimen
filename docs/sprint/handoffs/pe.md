# PE handoff (session pe-99, took over from pe-1b; sprint 3 stopped by the owner after SPC-26, 2026-10-15)

Read your brief (`specimen-herdr/worktrees/sprint-log/docs/sprint/briefs/principal-engineer.md`), then this file.
Orchestrator: check ListAgents (last `specimen-c8`, earlier `specimen-53`). Worktree: `specimen-herdr/worktrees/pe`, branch `pe/sprint-2`.
pe-99 is standing by. Nothing is open for the PE.

## State at the stop
- **Merged:** #26 SPC-24 Council v2 (986317e) · #27 SPC-25 (d279592) · #28 SPC-16 (8db2562) · #29 SPC-17 (DesignScan v4).
- **#30 SPC-26:** lens A final APPROVED on ef29d3e, with db.ts keeping both the parse writers and the chat gate, the
  M1 fold and the flake fix all checked. It merges once CI is green and the owner says go.
- **Not started (next sprint):**
  - Lane A: SPC-18 (llmHost: keep `attachLlmPort` and re-run the council tests), then SPC-21 (shared chrome stub; deny
    is opt-in).
  - Lane B: SPC-19 → SPC-20 → SPC-27.
- **Follow-ups filed:** SPC-28 (the waitForTabLoad race), SPC-29 (T3.33 flake: the 1 s findByTestId; ef29d3e only
  treats the symptom), SPC-30 (OpenAI insufficient_quota), SPC-31 (SPC-17 B6), and SPC-24 B-L4 (Inspect `onConnect`
  hardening).
- **Pending:** spc-17-82's post-merge security review of SPC-17 (ReDoS, hostile imports). Findings come as
  fix-forward tickets via the orchestrator.
- **Review files:** in each executor's worktree, `docs/sprint/reviews/<ticket>-a-r<n>.md`. The SPC-24 architecture note
  is in this worktree.

## Contracts in force
- **`DesignScan` v4** (SPC-17, owner OK 2026-10-15):
  - every palette `hex` (base and variants) is `#rrggbb`;
  - every role points at a palette id (the variant's palette, else the base one);
  - v1–3 rows are repaired on read: a fixable hex is normalized, an unfixable or `transparent` token is dropped along
    with its roles, and one warning is added;
  - v4 is strict;
  - `db.ts` writers validate.
- **Council Port/runtime protocol v1** (SPC-24): Port `council`.
  - Panel → host: `start{…, resolvedAt}`, `stop`, `attach`.
  - Host → panel: `snapshot` (live run, else the last finished one, else null), `turn`, `status{…, summaryText?}`,
    `rejected`.
  - Host → SW: `council.started`, `council.finished`. SW → host: `council.halt{at}`.
  - The amendments are owner OK 2026-10-15.
- **`LLMProvider`/`ProviderError`:**
  - kinds unchanged;
  - every HTTP-path message is fixed text, with no body or `cause`;
  - no `retryAfterMs` (adding one is a contract change, header only).
- **Earlier contracts** (TESTING ⊘ format, check-ids, site CSP, gitleaks): unchanged; see this file's git history.

## Known limitations carried
- The WebLLM abort/disconnect bugs (H1, H2) belong to SPC-18.
- The TPM is keyed by provider, not model.
- Stored scans are repaired per read, not written back.
- A pre-SPC-16 key in Ask history is scrubbed once; with a locked key, the exact-key pass waits for an unlock.

## Lessons
1. **Probe claims cheaply.** A 3-line tsx probe beats reading alone.
2. **Check that a test's fake matches production** (ids, storage key names, Chrome Port behaviour).
3. **MV3:** the SW dies after about 30 s idle, and the offscreen document is the durable host. Every Port post must
   survive a dead peer.
4. **Write architecture decisions before the plan arrives.**
5. **Contract rulings:** agree with the executor first, then send ONE final ruling to both the executor and the
   orchestrator.
6. **Never write in the main checkout,** not even `git pull`. Read main with `git show origin/main:<path>`.
7. **Re-check the diff after lens-B folds.** The SPC-25 fold brought in a new way to close the user's window.
8. **A stricter schema plus silent skip-on-read means data loss.** Repair old rows, prove real output passes, and
   validate on write.
