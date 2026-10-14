# SPC-7 lens A review, round 1 (PE, 2026-10-14)

PR #20, commit 8ab50e1. Scope: `apps/video/test/compositions.test.ts`, `apps/video/vitest.config.ts`, the
package.json scripts (root and video), the ci.yml video step and `pnpm-lock.yaml`.

**Result: 0 CRITICAL · 0 HIGH · 0 MEDIUM · 3 LOW. Lens A approves.** The LOWs are optional.

Checked and fine:
- **Independent spec.** The test reads Root()'s real `<Composition>` props, with no render and no Chrome, and compares
  them against an independent hand table. The table's maths is correct (30s 900, 40s 1200, suno 1028, mix 940).
  Anything in Root that isn't a Composition or a Fragment is an error, so nothing is silently skipped.
- **Can fail.** The checker fails on an off-by-one frame, a wrong fps, a fractional count, and a missing, extra or
  duplicate composition, and each case asserts the exact message. `toReal(v, DURATION)` is tied to the table within 1
  frame, which also covers the audio length.
- **Gate stays video-free.** In the root `test`, `--filter '!@specimen/video'` (exclusion only) selects every other
  package, so the gate, whose CI install skips video, can't break.
- **CI.** The ci.yml video step runs under the existing changed-guard, and `pnpm i --filter @specimen/video` installs
  vitest. `typecheck:video` / `test:video` follow the existing pattern.
- **Lockfile.** It adds the vitest importer entry with no new package versions. The other hunks only re-key webpack's
  peer context from esbuild 0.28.1 to 0.28.2, and 0.28.2 was already in the lockfile. That affects only the video
  renderer's bundler and changes no versions, so it's acceptable.

## LOW

**L1. The test file is never typechecked.** `apps/video/tsconfig.json` has `include: ["src", "scripts", "*.ts"]`, so
`test/` isn't covered, and the root `pnpm typecheck` excludes video. Vitest (oxc) strips types without checking them.
If, say, `sceneRange`'s signature changes, the casts in the test hide the error until runtime. *Fix:* add `"test"` to
the include list.

**L2. `expect(lastEnd).toBe(DURATION)` can't fail.** `sceneRange` returns `DURATION` for the last scene by definition
(`SCENES[i + 1]?.[1] ?? DURATION`). The real risk is a last scene so short it's cut off. *Fix:* assert that the last
scene runs for at least one bar in design seconds (`DURATION - lastStart >= 2`) and drop the tautology, or keep it with
a comment that it documents rather than tests.

**L3. The Root.tsx "Six compositions" comment is stale (there are 12).** It's outside the lane, so make sure it's
listed in the PR body as a follow-up (my plan note 3).
