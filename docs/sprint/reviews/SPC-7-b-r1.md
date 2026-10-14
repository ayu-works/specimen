# SPC-7 lens B r1 (real-world failures)

Reviewer: fresh lens B · 2026-10-14 · PR #20 at `749eb35` · **0 CRITICAL / 1 HIGH / 1 MEDIUM / 4 LOW**

## What I ran (scratch clones in my scratchpad, offline, nothing in the worktree touched)
- The gate job's install: `pnpm i --frozen-lockfile --offline --filter '!@specimen/video'` → exit 0, 308 packages. The set in
  `node_modules/.pnpm` is **the same as main's** (diff empty, 310 entries each). No new dependency in the gate.
- The video job's install: `pnpm i --frozen-lockfile --offline --filter @specimen/video` → exit 0.
- Relock (`pnpm i --lockfile-only`) on the branch → no diff, so the webpack/esbuild peer-suffix shuffle is stable and
  doesn't flip back. Some snapshot references look dangling (`webpack@5.105.0(esbuild@0.28.1)(postcss@8.5.29)` has no
  key), but main had the same kind of dangling reference and frozen installs pass. Not a finding.
- `pnpm test:video` → 8/8 in 177 ms (2.4 s wall). Only `remotion` and `timeline.ts` load. Fonts, audio and network
  don't run, because `Main` is mocked. Not flaky: pure, no timers, no I/O.
- Mutations: (a) I added `calculateMetadata={() => ({ durationInFrames: 1, fps: 25 })}` to every `<Composition>`. Tests
  **8/8 pass** and typecheck is clean. (b) I changed `index.ts` to `registerRoot(() => null)`. Tests **8/8 pass**.
  (c) I added `test` to the video tsconfig include. `tsc` was clean.

## HIGH

### H1. A composition whose duration is computed at render time passes the test
**Scenario:** someone adds `calculateMetadata` to a `<Composition>`, for example to size a cut from the song's real
length, which is a natural next step for `suno` and `mix`. Remotion's `selectComposition` in `scripts/render.ts` uses
what `calculateMetadata` returns, not the static `durationInFrames`/`fps` props. The test only reads the static props,
so it stays green while every render has the wrong length. In mutation (a), all 12 renders were 1 frame at 25 fps and
the test still passed 8/8. This is the "durations computed at runtime" gap that T7.04 exists to catch.
**Fix:** in `checkCompositions`, fail when a composition has `calculateMetadata`. If you want to allow it, call it
with `{ defaultProps, props: defaultProps, abortSignal, compositionId }` and check the returned
`durationInFrames`/`fps` against the table instead. Add a failure-path case: "T7.04 calculateMetadata overriding the
duration is caught". Add `calculateMetadata?: unknown` to the `Comp` type.

## MEDIUM

### M1. The test checks `Root`, not the root that Remotion actually registers
**Scenario:** `src/index.ts` is what `bundle()` and `render.ts` use. If it changes to `registerRoot(OtherRoot)` (for
example a new root for a teaser, or a wrapper that adds a `<Folder>`), the test still walks the old `Root` and passes.
Mutation (b) confirmed this. New compositions registered that way are silently not covered.
**Fix:** a cheap guard. Mock `remotion`'s `registerRoot` with `vi.mock('remotion', async (orig) => ({ ...(await orig()),
registerRoot: vi.fn() }))`, import `../src/index`, and assert it was called once with the same `Root` the test walks.
The test then reads the component it actually registers.

## LOW

### L1. The video job's change filter misses files that can break `test:video`
**Scenario:** a PR changes only the root `package.json` (for example it renames or breaks `test:video` or
`typecheck:video`), `ci.yml`'s video job, or `tsconfig.base.json` (which the video tsconfig extends). The job skips,
and the breakage shows up on the next PR that touches `apps/video`, which then gets blamed. A failing `git diff`
(unknown base) already falls back to running, which is correct.
**Fix:** add `package.json tsconfig.base.json .github/workflows/ci.yml` to the `git diff --quiet` path list.

### L2. The video install now pulls `jsdom`
The vitest snapshot in the video importer is `vitest@5.0.3(...)(jsdom@30.1.2)(...)`. It reuses the extension's peer
set, so the video job installs jsdom even though the test runs in the `node` environment. It costs a few seconds of
install time and has no effect on correctness. **Fix:** none needed. Mention it in the handoff if the video job's
install time is ever a concern.

### L3. `test/` isn't typechecked (same as lens A L1, confirmed)
It compiles cleanly today when I add it to the include. **Fix:** add `"test"` to `apps/video/tsconfig.json`
`include`.

### L4. Unhelpful error for host elements, and a scope note
`String((el.type as { name?: string }).name)` gives `undefined` for a host element like `<div>`. **Fix:** use
`typeof el.type === 'string' ? el.type : el.type.name`. Scope: `749eb35` edits `src/Root.tsx` (comment only), but
the PE plan review said `src/` is outside the lane and the comment fix belonged in the PR body as a follow-up. It's
harmless, but it's a post-review change, so the PE should acknowledge it.
