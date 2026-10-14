// Run: pnpm test:scripts (node:test via tsx). Integration tests need gitleaks; they skip
// locally without it but are required in CI, so they can't skip silently there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  checkVersion,
  LOG_OPTS,
  onMissing,
  onScan,
  onShallow,
  requireGitleaks,
  scan,
} from './secret-scan';

describe('secret scan decisions', () => {
  test('T6.07 a findings exit (1) fails the scan', () => {
    const r = onScan(1);
    assert.equal(r.ok, false);
    assert.match(r.message, /found secrets/);
  });

  test('T6.07 an unexpected exit code or spawn error fails as a scan error, never as clean', () => {
    for (const r of [onScan(2), onScan(126), onScan(null), onScan(0, new Error('EACCES'))]) {
      assert.equal(r.ok, false);
      assert.doesNotMatch(r.message, /clean/);
    }
    assert.equal(onScan(0).ok, true);
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

  test('T6.07 the scan excludes the shared stash ref, with --exclude before --all', () => {
    assert.equal(LOG_OPTS, '--exclude=refs/stash --all');
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
