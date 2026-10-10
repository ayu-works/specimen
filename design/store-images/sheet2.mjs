import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const ids=process.argv.slice(2);
const html=`<body style="margin:0;display:flex;flex-wrap:wrap;gap:6px;background:#888;font:20px sans-serif">${ids.map(i=>`<div><img src="crops/c${i}.png" style="height:760px"><br>${i}</div>`).join('')}</body>`;
const d=import.meta.dirname;writeFileSync(d+'/_s2.html',html);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:2400,height:800}});await p.goto('file://'+d+'/_s2.html');await p.waitForTimeout(500);await p.screenshot({path:'/tmp/x.png'.replace('/tmp/x.png',d+'/_s2.png'),fullPage:true});await b.close();
