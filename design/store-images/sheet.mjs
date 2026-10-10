import { readdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const [dir, out, from, to] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith('.png') && f.startsWith('f')).sort().slice(Number(from), Number(to));
const html = `<body style="margin:0;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:#000;font:14px sans-serif;color:#fff">${files.map((f) => `<div><img src="${f}" style="width:100%"><div>${f}</div></div>`).join('')}</body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 800 } });
writeFileSync(`${dir}/_sheet.html`, html); await p.goto(`file://${dir}/_sheet.html`); await p.waitForTimeout(500); await p.screenshot({ path: out, fullPage: true }); await b.close();
