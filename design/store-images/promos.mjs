import { HOST, mascot, wordmark, panel, pixels, render, TUFT, OUT, D } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const grid = `<div class="grid"></div>`;
// small promo 440x280
await render('promo-s', 440, 280, `${grid}<div class="glow" style="left:120px;top:40px;width:200px;height:200px;opacity:.8"></div>
${pixels([[24,24,TUFT[0],12],[404,30,TUFT[3],12],[22,240,TUFT[2],12],[408,236,TUFT[1],12]])}
<div style="position:absolute;left:0;right:0;top:38px;display:flex;justify-content:center;align-items:center;gap:20px">${mascot('happy', 96)}${wordmark(0.5)}</div>
<div style="position:absolute;left:0;right:0;top:176px;text-align:center;font-size:24px;font-weight:800;letter-spacing:-.01em">Design system <span style="color:#A99BFF">&rarr;</span> AI prompt</div>
<div style="position:absolute;left:0;right:0;top:218px;display:flex;justify-content:center;gap:6px">${TUFT.map(c => `<i style="width:10px;height:10px;background:${c};display:block"></i>`).join('')}</div>`,
 { file: 'promo-small-440x280' });
// marquee 1400x560
const host = [HOST];
await render('promo-m', 1400, 560, `${grid}<div class="glow" style="left:930px;top:60px;width:420px;height:420px"></div>
${pixels([[60,60,TUFT[0]],[700,40,TUFT[1],12],[820,500,TUFT[2]],[40,500,TUFT[3],12],[640,480,TUFT[4],12],[1340,40,TUFT[3],12]])}
<div style="position:absolute;left:80px;top:130px;display:flex;align-items:center;gap:36px">${mascot('happy', 160)}${wordmark(0.75)}</div>
<div style="position:absolute;left:80px;top:330px;font-size:40px;font-weight:800;line-height:1.12;letter-spacing:-.02em;width:700px">Scan any website's design.<br><span style="color:#A99BFF">Hand it to your AI.</span></div>
<div style="position:absolute;left:80px;top:446px;font-size:20px;color:#C4C1E0">Free &middot; Open source &middot; No account &middot; No tracking</div>
${panel({ x: 880, y: 44, src: 'p18', cx: 10, cy: 3, cw: 354, ch: 600, s: 1.0, masks: host })}`,
 { file: 'promo-marquee-1400x560' });
// icon 128 (transparent)
await render('icon', 128, 128, `<style>html,body{background:transparent!important}</style><div style="position:absolute;left:0;top:8px">${mascot('idle', 128)}</div>`, { file: 'icon-128', omitBackground: true });
