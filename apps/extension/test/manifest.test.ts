import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = `${appRoot}.output/chrome-mv3/manifest.json`;

describe('manifest', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['exec', 'wxt', 'build'], { cwd: appRoot, stdio: 'pipe' });
  });

  it('T0.03 manifest permissions match spec', () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect([...m.permissions].sort()).toEqual(
      ['activeTab', 'scripting', 'sidePanel', 'storage', 'offscreen', 'unlimitedStorage'].sort(),
    );
    expect(m.optional_host_permissions).toEqual(['<all_urls>']);
    expect(m.host_permissions).toBeUndefined();
    expect(m.content_scripts).toBeUndefined();
    expect(m.side_panel?.default_path).toBe('sidepanel.html');
    expect(m.content_security_policy.extension_pages).toContain("'wasm-unsafe-eval'");
    expect(m.commands._execute_action.suggested_key.default).toBe('Alt+Shift+S');
  });
});
