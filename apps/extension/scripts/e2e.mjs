// Build the E2E flavour of the extension (adds host_permissions for local fixture servers)
// plus the sampler IIFE, then run Playwright. Output goes to .output-e2e so the normal
// .output build is never polluted.
import { spawnSync } from 'node:child_process';

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('pnpm', ['exec', 'wxt', 'build'], { SPECIMEN_E2E: '1' });
run('node', ['scripts/build-sampler.mjs']);
run('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)]);
