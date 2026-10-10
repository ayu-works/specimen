import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const d=import.meta.dirname; const ids=process.argv.slice(2);
const grid=`<div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,0,0,.45) 1px,transparent 1px),linear-gradient(90deg,rgba(255,0,0,.45) 1px,transparent 1px);background-size:50px 50px"></div>`;
const lab=Array.from({length:15},(_,i)=>`<span style="position:absolute;left:2px;top:${i*50}px;color:yellow;font:10px monospace">${i*50}</span>`).join('');
const html=`<body style="margin:0;display:flex;gap:10px;background:#444">${ids.map(i=>`<div style="position:relative;width:380px;height:720px"><img src="crops/p${i}.png" width=380 height=720>${grid}${lab}</div>`).join('')}</body>`;
writeFileSync(d+'/_g.html',html);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:400*ids.length,height:720},deviceScaleFactor:2});await p.goto('file://'+d+'/_g.html');await p.waitForTimeout(400);await p.screenshot({path:d+'/_g.png'});await b.close();
