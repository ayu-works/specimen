// Usage: tsx scripts/secret-scan.ts            (pnpm secrets; part of pnpm gate)
// T6.07: scans the whole git history for secrets with gitleaks. Findings are always redacted.
// A missing gitleaks skips the scan locally but fails it in CI or with SPECIMEN_REQUIRE_GITLEAKS=1.
// Any error (old gitleaks, shallow clone, unexpected exit) fails; it is never reported as clean.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** First release with the `gitleaks git` subcommand. CI pins its own exact version (ci.yml). */
export const MIN_VERSION: readonly [number, number] = [8, 19];
/** Every ref except refs/stash: the stash stack is shared by all worktrees on a machine. */
export const LOG_OPTS = '--exclude=refs/stash --all';

type Env = Record<string, string | undefined>;
export interface Outcome {
  ok: boolean;
  message: string;
}

const truthy = (v: string | undefined) =>
  v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

/** Whether a missing gitleaks must fail the scan instead of skipping it. */
export const requireGitleaks = (env: Env) =>
  truthy(env.CI) || env.SPECIMEN_REQUIRE_GITLEAKS === '1';

export function onMissing(env: Env): Outcome {
  if (requireGitleaks(env)) {
    return { ok: false, message: 'secrets: FAILED, gitleaks is not installed (required here)' };
  }
  return {
    ok: true,
    message:
      'secrets: SKIPPED, gitleaks is not installed, so the history was NOT scanned. ' +
      'Install it (brew install gitleaks) and rerun; CI always scans.',
  };
}

/** Returns an error outcome when the version is unparseable or older than MIN_VERSION. */
export function checkVersion(raw: string): Outcome | null {
  const m = raw.match(/(\d+)\.(\d+)/);
  if (!m) return { ok: false, message: `secrets: FAILED, can't read gitleaks version "${raw}"` };
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1])) return null;
  return {
    ok: false,
    message: `secrets: FAILED, gitleaks ${raw} is older than ${MIN_VERSION.join('.')}; upgrade it`,
  };
}

export function onShallow(): Outcome {
  return {
    ok: false,
    message: 'secrets: FAILED, shallow clone; the whole history is needed (fetch-depth: 0)',
  };
}

/** gitleaks' findings exit code. Not 1: gitleaks also exits 1 on its own fatal errors (bad config, git failure). */
export const FINDINGS_EXIT = 3;

/** Commit count from gitleaks' "N commits scanned." line, or null when it's missing. */
export function commitsScanned(output: string): number | null {
  const m = output.match(/(\d+) commits? scanned/);
  return m ? Number(m[1]) : null;
}

/**
 * Maps the gitleaks result. Clean needs exit 0 and at least one commit scanned;
 * FINDINGS_EXIT is findings; anything else is an error.
 */
export function onScan(status: number | null, error?: Error, output = ''): Outcome {
  if (error || status === null) {
    return {
      ok: false,
      message: `secrets: FAILED, gitleaks did not run (${error?.message ?? 'killed'})`,
    };
  }
  if (status === FINDINGS_EXIT) {
    return { ok: false, message: 'secrets: FAILED, gitleaks found secrets (above)' };
  }
  if (status !== 0) {
    return { ok: false, message: `secrets: FAILED, gitleaks scan error (exit ${status})` };
  }
  const commits = commitsScanned(output);
  if (!commits) {
    return { ok: false, message: 'secrets: FAILED, gitleaks scanned no commits' };
  }
  return { ok: true, message: `secrets: clean, whole history scanned (${commits} commits)` };
}

export interface ScanResult extends Outcome {
  /** gitleaks' own output (redacted), empty when it never ran. */
  output: string;
}

/** Runs the whole check against `repo` with this repo's gitleaks config and ignore file. */
export function scan({
  repo = root,
  env = process.env as Env,
  config = join(root, '.gitleaks.toml'),
} = {}): ScanResult {
  const bin = env.GITLEAKS_BIN || 'gitleaks';
  const ver = spawnSync(bin, ['version'], { encoding: 'utf8', env });
  if ((ver.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return { ...onMissing(env), output: '' };
  }
  if (ver.error || ver.status !== 0) {
    return { ...onScan(ver.status, ver.error ?? new Error('gitleaks version failed')), output: '' };
  }
  const tooOld = checkVersion(ver.stdout.trim());
  if (tooOld) return { ...tooOld, output: '' };

  const shallow = spawnSync('git', ['-C', repo, 'rev-parse', '--is-shallow-repository'], {
    encoding: 'utf8',
    env,
  });
  if (shallow.error || shallow.status !== 0) {
    return { ok: false, message: `secrets: FAILED, ${repo} is not a git repository`, output: '' };
  }
  if (shallow.stdout.trim() !== 'false') return { ...onShallow(), output: '' };

  const run = spawnSync(
    bin,
    [
      'git',
      '--redact',
      '--verbose',
      '--no-banner',
      '--no-color',
      '--exit-code',
      String(FINDINGS_EXIT),
      '--config',
      config,
      '--gitleaks-ignore-path',
      join(root, '.gitleaksignore'),
      `--log-opts=${LOG_OPTS}`,
      repo,
    ],
    { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const outcome = onScan(run.status, run.error, output);
  const version = ver.stdout.trim();
  return {
    ...outcome,
    message: outcome.ok
      ? `${outcome.message} (gitleaks ${version}; CI's pinned run is authoritative)`
      : outcome.message,
    output,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = scan();
  if (result.output) process.stdout.write(result.output);
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
