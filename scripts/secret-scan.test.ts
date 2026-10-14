// Run: pnpm test:scripts (node:test via tsx). Integration tests need gitleaks; they skip
// locally without it but are required in CI, so they can't skip silently there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  checkVersion,
  commitsScanned,
  FINDINGS_EXIT,
  onMissing,
  onScan,
  onShallow,
  requireGitleaks,
  scan,
} from './secret-scan';

const SCANNED = 'INF 12 commits scanned.';

describe('secret scan decisions', () => {
  test('T6.07 the findings exit fails the scan as found secrets', () => {
    const r = onScan(FINDINGS_EXIT, undefined, SCANNED);
    assert.equal(r.ok, false);
    assert.match(r.message, /found secrets/);
  });

  test('T6.07 exit 1 (a gitleaks fatal error), other exits and spawn errors fail as a scan error', () => {
    for (const r of [
      onScan(1, undefined, SCANNED),
      onScan(2, undefined, SCANNED),
      onScan(126, undefined, SCANNED),
      onScan(null),
      onScan(0, new Error('EACCES'), SCANNED),
    ]) {
      assert.equal(r.ok, false);
      assert.doesNotMatch(r.message, /clean|found secrets/);
    }
    const ok = onScan(0, undefined, SCANNED);
    assert.equal(ok.ok, true);
    assert.match(ok.message, /12 commits/);
  });

  test('T6.07 a clean exit with a gitleaks ERR or FTL line fails as a scan error', () => {
    for (const out of [
      `6:41PM ERR [git] fatal: unable to read abc\n6:41PM ERR error="stderr is not empty"\n${SCANNED}`,
      `FTL something broke\n${SCANNED}`,
    ]) {
      const r = onScan(0, undefined, out);
      assert.equal(r.ok, false);
      assert.match(r.message, /scan error/);
    }
  });

  test('T6.07 output too large to read fails with its own message', () => {
    const err = Object.assign(new Error('spawnSync gitleaks ENOBUFS'), { code: 'ENOBUFS' });
    assert.match(onScan(null, err).message, /too large/);
  });

  test('T6.07 .gitleaks.toml has no allowlist or disabled rules (false positives go in .gitleaksignore by fingerprint)', () => {
    const toml = readFileSync(join(import.meta.dirname, '..', '.gitleaks.toml'), 'utf8');
    assert.doesNotMatch(toml, /^\s*\[{1,2}\s*(?:rules\.)?allowlists?\b/im);
    assert.doesNotMatch(toml, /^\s*disabledRules\b/im);
    assert.match(toml, /useDefault\s*=\s*true/);
  });

  test('T6.07 a clean exit that scanned no commits fails', () => {
    assert.equal(commitsScanned('INF 1 commits scanned.'), 1);
    assert.equal(commitsScanned('no leaks found'), null);
    assert.equal(onScan(0, undefined, 'INF 0 commits scanned.\nINF no leaks found').ok, false);
    assert.equal(onScan(0, undefined, 'INF no leaks found').ok, false);
  });

  test('T6.07 missing gitleaks locally warns and skips; missing in CI or when required fails', () => {
    const local = onMissing({});
    assert.equal(local.ok, true);
    assert.match(local.message, /NOT scanned/);
    for (const env of [{ CI: 'true' }, { CI: '1' }, { SPECIMEN_REQUIRE_GITLEAKS: '1' }]) {
      assert.equal(requireGitleaks(env), true);
      assert.equal(onMissing(env).ok, false);
    }
    for (const env of [{ CI: 'false' }, { CI: '0' }, { CI: '' }]) {
      assert.equal(requireGitleaks(env), false);
    }
  });

  test('T6.07 a missing binary is detected end to end', () => {
    const r = scan({ env: { ...process.env, CI: '', GITLEAKS_BIN: '/nonexistent/gitleaks' } });
    assert.equal(r.ok, true);
    assert.match(r.message, /SKIPPED/);
    const ci = scan({ env: { ...process.env, CI: 'true', GITLEAKS_BIN: '/nonexistent/gitleaks' } });
    assert.equal(ci.ok, false);
  });

  test('T6.07 a shallow clone fails', () => {
    assert.equal(onShallow().ok, false);
  });

  test('T6.07 gitleaks older than 8.19 or with an unreadable version fails', () => {
    assert.equal(checkVersion('8.18.4')?.ok, false);
    assert.equal(checkVersion('7.6.1')?.ok, false);
    assert.equal(checkVersion('dev')?.ok, false);
    assert.equal(checkVersion('8.19.0'), null);
    assert.equal(checkVersion('v8.30.1'), null);
    assert.equal(checkVersion('9.0.0'), null);
  });
});

const hasGitleaks = spawnSync(process.env.GITLEAKS_BIN || 'gitleaks', ['version']).status === 0;
const ci = requireGitleaks(process.env);
if (ci && !hasGitleaks) throw new Error('T6.07: gitleaks is required in CI but not installed');
const skip = hasGitleaks ? false : 'gitleaks not installed (CI runs these)';

/** Git isolated from the user's config: no signing, hooks or templates from ~/.gitconfig. */
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd: string, ...args: string[]) {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, env: gitEnv, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
}

function withRepo(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'specimen-t607-'));
  try {
    git(dir, 'init', '-q', '-b', 'main');
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Assembled at runtime so this file never matches a rule itself. Generic shape, not a real provider's.
const FAKE = ['Zq7', 'xW2', 'pL9', 'kV4', 'mN8', 'rT1', 'bY6', 'cH3'].join('');

describe('secret scan against a real git history', { skip }, () => {
  test('T6.07 a fake key committed and then deleted is still found in history, redacted', () => {
    withRepo((dir) => {
      const file = join(dir, 'settings.py');
      writeFileSync(file, `api_key = "${FAKE}"\n`);
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'add settings');
      unlinkSync(file);
      writeFileSync(join(dir, 'README.md'), 'nothing here\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'remove settings');

      const r = scan({ repo: dir, env: gitEnv });
      assert.equal(r.ok, false);
      assert.match(r.message, /found secrets/); // exit exactly 1, not a scan error
      assert.match(r.output, /RuleID:\s+generic-api-key/);
      assert.match(r.output, /leaks found: [1-9]/);
      assert.ok(!r.output.includes(FAKE), 'the secret must be redacted');
      assert.ok(!r.message.includes(FAKE));
    });
  });

  test('T6.07 a git failure inside gitleaks (a missing object) fails, never reads as clean', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'settings.py'), `api_key = "${FAKE}"\n`);
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'add settings');
      const blob = spawnSync('git', ['rev-parse', 'HEAD:settings.py'], {
        cwd: dir,
        env: gitEnv,
        encoding: 'utf8',
      }).stdout.trim();
      unlinkSync(join(dir, 'settings.py'));
      writeFileSync(join(dir, 'README.md'), 'nothing here\n');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'remove settings');
      unlinkSync(join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));

      const r = scan({ repo: dir, env: gitEnv });
      assert.equal(r.ok, false, r.output + r.message);
      assert.match(r.message, /scan error/);
      assert.doesNotMatch(r.message, /clean/);
    });
  });

  test('T6.07 a broken gitleaks config fails as a scan error, not as found secrets', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'README.md'), 'nothing here\n');
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'readme');
      const config = join(dir, 'broken.toml');
      writeFileSync(config, '[[\n');
      const r = scan({ repo: dir, env: gitEnv, config });
      assert.equal(r.ok, false);
      assert.match(r.message, /scan error \(exit 1\)/);
    });
  });

  test('T6.07 a key that exists only in the shared stash is not scanned', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'README.md'), 'nothing here\n');
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'readme');
      writeFileSync(join(dir, 'settings.py'), `api_key = "${FAKE}"\n`);
      git(dir, 'stash', 'push', '-q', '-u', '-m', 'wip');
      const r = scan({ repo: dir, env: gitEnv });
      assert.equal(r.ok, true, r.output + r.message);
      assert.match(r.message, /\(1 commits\)/);
    });
  });

  test('T6.07 a shallow clone fails instead of scanning part of the history', () => {
    withRepo((dir) => {
      for (const n of [1, 2]) {
        writeFileSync(join(dir, 'README.md'), `v${n}\n`);
        git(dir, 'add', '.');
        git(dir, 'commit', '-q', '-m', `v${n}`);
      }
      const clone = join(dir, 'shallow');
      git(dir, 'clone', '-q', '--depth', '1', `file://${dir}`, clone);
      const r = scan({ repo: clone, env: gitEnv });
      assert.equal(r.ok, false);
      assert.match(r.message, /shallow/);
    });
  });

  test('T6.07 a clean history passes', () => {
    withRepo((dir) => {
      writeFileSync(join(dir, 'README.md'), 'nothing here\n');
      git(dir, 'add', '.');
      git(dir, 'commit', '-q', '-m', 'readme');
      const r = scan({ repo: dir, env: gitEnv });
      assert.equal(r.ok, true, r.output + r.message);
      assert.match(r.output, /no leaks found/);
    });
  });
});
