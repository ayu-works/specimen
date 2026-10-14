# SPC-7 handoff: T7.04 Remotion compositions have frame count = fps × duration

Executor: spc-7-08 (lane A) · Branch: `exec/spc-7` · Status: **built, PR open, waiting for reviews** (PE approved 2026-10-14 with changes, folded in below)

## PE approval changes (2026-10-14, pe-5e) — these win over the plan below
1. Assertion 3 (scenes fit within DURATION) is required. Done: scene starts strictly increase from 0, the last
   scene starts before DURATION and `sceneRange` ends it at DURATION, and in real frames it starts before each cut's
   final frame.
2. `toReal(v, DURATION)` from the real timeline is within 1 frame of the hand table. Done (second test).
3. Root.tsx's "Six compositions" comment is stale (there are 12); `src/` is outside lane A, so it's a follow-up in
   the PR body, not edited.

## Plan

### Approach
A Vitest unit test in `apps/video` that reads the registered compositions **as React elements, without rendering
anything** (no bundle, no Chrome, no frames):

- `Root` (`src/Root.tsx`) is a plain function component that returns a fragment of `<Composition>` elements. The test
  calls `Root()` and walks `props.children` (flattened) to collect every element whose `type === Composition`, reading
  `id`, `fps`, `durationInFrames`, `width`, `height`, `defaultProps`. Anything in the fragment that isn't a
  `Composition` fails the test (so a wrapper/`<Folder>` added later is noticed, not silently skipped).
- `vi.mock('../src/Main')` replaces the scene component with a stub, so the test doesn't load the scenes, fonts
  (`@remotion/google-fonts` in `theme.ts`) or audio. The test only checks registration metadata, which is what T7.04
  is about. `remotion` itself is imported for real (its `Composition` is the identity we match on).
- Why not `@remotion/renderer` `getCompositions()`: it bundles with webpack and launches headless Chrome. That is
  the slow, heavy path the ticket rules out, and CI would have to download Chrome.

**Expected values are written down independently, not recomputed with `framesFor`** (that would be a tautology: a
wrong `toReal` or `DURATION` would pass). The test holds a table of each cut's on-screen length in seconds, derived by
hand from the README/timeline comments:

| Cut | On-screen seconds | Frames at 30 fps |
|---|---|---|
| 30s | 30 | 900 |
| 40s | 30 / 0.75 = 40 | 1200 |
| suno | 30 / (105.04 / 120) ≈ 34.273 | 1028 |
| mix | 2 / 0.6 + 28 ≈ 31.333 | 940 |

and the three formats (16x9 1920×1080, 1x1 1080×1080, 9x16 1080×1920).

### Assertions (`T7.04 …`)
1. Exactly 12 compositions = the 4 cuts × 3 formats in the table; ids unique; the set of ids equals the expected set
   (a cut added to `VARIANTS` with no row in the table fails; a row with no composition fails).
2. For each: `fps === 30`; `durationInFrames` is a positive integer and equals `Math.round(seconds × fps)` from the
   table (tolerance 0 frames); `width`/`height` match the format; `defaultProps.variant` matches the id's cut and
   `defaultProps.audio === audio-<cut>.wav` (the file `scripts/music.ts` writes).
3. The scene timeline fits: the last scene in `SCENES` ends at or before `DURATION` design seconds, so no cut's
   picture is cut short by its frame count. (If `SCENES` doesn't expose ends cleanly I'll drop this one and say so.)
4. **Failure path:** the check is a small pure function `checkCompositions(found, expected) → string[]` (errors) in
   the test file. Extra cases feed it a composition with one wrong `durationInFrames` (off by one frame), a wrong fps,
   a missing id and an extra id, and assert each produces an error. Plus the ticket's manual check: a scratch edit of
   one duration (e.g. `40s` speed 0.75 → 0.8) makes `pnpm -F @specimen/video test` fail; I paste that output in the PR
   and revert (never committed).

### Files
- `apps/video/test/compositions.test.ts` (new): the test above.
- `apps/video/vitest.config.ts` (new): `include: ['test/**/*.test.ts']`, node environment.
- `apps/video/package.json`: `"test": "vitest run"`, devDependency `vitest` (same `^5.0.3` as the other packages,
  so the lockfile only gains the importer entry, no new versions).
- `pnpm-lock.yaml`: the importer change from the above.
- Root `package.json`: `"test"` becomes `pnpm -r --filter '!@specimen/video' --if-present test && pnpm test:scripts`.
  **Required:** without this filter the gate's `pnpm test` would pick up the new script, but the gate's CI install
  skips `@specimen/video`, so the gate would break, and the ticket says not in `pnpm gate`. Add `"test:video":
  "pnpm -F @specimen/video test"` next to `typecheck:video`.
- `.github/workflows/ci.yml` (video job, per the override comment): a `pnpm test:video` step after
  `pnpm typecheck:video`, under the same `steps.changed.outputs.run == 'true'` guard (runs only when `apps/video` or
  the lockfile changed, which this PR does, so the job runs it on this PR).
- `apps/video/README.md`: one line on `pnpm -F @specimen/video test`.
- No changes to `src/`, renders, `public/` audio or `scripts/`.

### Failure modes
- **Tautology / drift between two copies of a fact:** the expected seconds are a second copy of the timeline. That's
  the point (it's the spec), and the table comments say where each number comes from; a deliberate timing change
  must update both, which is the review signal we want.
- **Rounding:** Remotion needs integer frames; `framesFor` uses `Math.round`. The test asserts integer and exact
  equality to `Math.round(seconds × 30)`, so a float or a rounding change (`floor`) fails (suno: 1028.18 → 1028).
- **Silent skip:** a composition registered outside the fragment, or a `Folder` wrapper, fails assertion 1 rather
  than being ignored. Zero compositions found fails (`found.length === 12`).
- **Gate leakage:** covered by the root `test` filter above; I'll run `pnpm gate` to show it doesn't run or need video.
- **CI skip logic:** the job's "changed" check is unchanged; on a push with no video/lockfile changes it still skips
  (by design). Not idempotency/concurrency sensitive: the test is pure, no files written, no processes.
- **Module side effects:** importing `Root` pulls `Main` → scenes → fonts; mocked away. If `remotion` itself fails to
  import under Node/Vitest I'll report it before working around it.

### Check (agreed narrower check, not the full gate for video)
`pnpm -F @specimen/video test` green; scratch-edit run red (pasted in PR); `pnpm -F @specimen/video typecheck`;
`pnpm lint`; and `pnpm gate` green to show the root filter keeps video out of it.

## Done
- `apps/video/test/compositions.test.ts` (8 tests, all `T7.04 …`), `apps/video/vitest.config.ts`, `"test"` script +
  `vitest ^5.0.3` devDependency; root `test` filters out `@specimen/video`, new `test:video`; `ci.yml` video job runs
  `pnpm test:video`; README line.
- The checker's failure-path cases build their fixtures from the spec table, not from Root, so they test the
  checker on its own.
- Lockfile: one importer entry; the rest is pnpm re-resolving webpack's optional `esbuild` peer suffix
  (0.28.1 ↔ 0.28.2). No package version was added or changed.
- Checks (2026-10-14): `pnpm test:video` 8/8; scratch edit `40s` speed 0.75 → 0.8 → 4 failures
  (`Promo40s-*: 1125 frames, expected 1200`, timeline drift 75 frames), reverted, never committed;
  `pnpm typecheck:video` clean; `pnpm lint` clean; `pnpm gate` exit 0 with video out of `pnpm test` (gitleaks not
  installed locally, so the secret scan skipped; CI scans).

## Next
- Reviews (PE lens A + lens B) → fold findings → owner merges.

## How to resume
Worktree `Specimen-wt/spc-7`, branch `exec/spc-7`. Read this file and any `docs/sprint/reviews/SPC-7-*.md`.
