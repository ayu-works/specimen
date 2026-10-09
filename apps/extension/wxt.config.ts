import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// E2E builds only: the Playwright harness can't grant activeTab, and chrome.tabs.captureVisibleTab
// accepts only activeTab or a literal <all_urls> host pattern (not 127.0.0.1 alone), so the test
// build declares <all_urls>. Never set in a normal build (T0.03 asserts there are no host_permissions).
const e2e = process.env.SPECIMEN_E2E === '1';

export default defineConfig({
  srcDir: 'src',
  outDir: e2e ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()], define: { __SPECIMEN_E2E__: JSON.stringify(e2e) } }),
  manifest: {
    name: 'Specimen',
    description:
      'Measure any website’s design system and export an agent-ready prompt, DESIGN.md and tokens.',
    permissions: [
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
      'offscreen',
      'unlimitedStorage',
      // E2E build only: Playwright can't click Chrome's permission prompt, so `debugger` is
      // pre-granted there (mobile/dark media emulation tests). Normal builds keep it optional.
      // `clipboardWrite` is also E2E-only: without it document.execCommand('copy') in the
      // offscreen document is rejected (no user activation there), so the Alt+Shift+C copy can
      // only be exercised with it. See the testing-pass report: production needs a decision.
      ...(e2e ? ['debugger' as never, 'clipboardWrite'] : []),
    ],
    // `debugger` is requested at runtime, only when the user turns on dark-mode capture.
    // (WXT's type list lacks it, though Chrome accepts it as an optional permission.)
    optional_permissions: (e2e ? [] : ['debugger']) as never[],
    optional_host_permissions: ['<all_urls>'],
    ...(e2e ? { host_permissions: ['<all_urls>'] } : {}),
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'Specimen' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+S' } },
      'scan-copy': {
        suggested_key: { default: 'Alt+Shift+C' },
        description: 'Scan this page and copy the AI prompt',
      },
    },
  },
});
