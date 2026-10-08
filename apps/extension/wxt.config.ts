import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
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
    ],
    optional_host_permissions: ['<all_urls>'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'Specimen' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+S' } },
    },
  },
});
