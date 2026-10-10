import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
export const D = import.meta.dirname;
export const OUT = D + '/../../store/images';
mkdirSync(OUT, { recursive: true });

const BODY = [[40,16,48,8],[24,24,80,8],[16,32,96,8],[16,40,96,8],[16,48,96,8],[16,56,96,8],[16,64,96,8],[16,72,96,8],[24,80,80,8],[24,88,80,8],[32,96,16,8],[80,96,16,8]];
const INK = '#1b1b2f', BLUSH = '#FF9FB8';
const r = (l, f) => l.map(([x,y,w,h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`).join('');
const BL = [[24,64,8,8],[96,64,8,8]];
const FACES = {
  idle: r([[32,48,8,16],[88,48,8,16]], INK) + r(BL, BLUSH) + r([[56,68,16,8]], INK),
  scanning: r([[40,48,8,16],[96,48,8,16]], INK) + r([[56,72,16,8]], INK),
  happy: r([[32,48,8,8],[24,56,8,8],[40,56,8,8],[88,48,8,8],[80,56,8,8],[96,56,8,8]], INK) + r(BL, BLUSH) + r([[48,72,8,8],[72,72,8,8],[56,80,16,8]], INK),
  thinking: r([[40,40,8,16],[96,40,8,16]], INK) + r(BL, BLUSH) + r([[72,72,8,8]], INK),
};
/** Static critter svg (art spans x16-112, y8-104 of a 128 box). size = css px of the 128 box. */
export function mascot(mood = 'idle', size = 96) {
  return `<svg viewBox="0 0 128 128" width="${size}" height="${size}" shape-rendering="crispEdges" style="display:block"><g shape-rendering="crispEdges">${r(BODY,'#7C6CF5')}<rect x="48" y="8" width="8" height="8" fill="#FF6B6B"/><rect x="56" y="8" width="8" height="8" fill="#FFD166"/><rect x="64" y="8" width="8" height="8" fill="#06D6A0"/><rect x="72" y="8" width="8" height="8" fill="#4D96FF"/><rect x="24" y="16" width="16" height="8" fill="#A99BFF"/>${FACES[mood]}</g></svg>`;
}
const WM = readFileSync(D + '/wordmark-rects.txt', 'utf8');
/** Pixel "Specimen" wordmark; scale 1 = 516x108. */
export function wordmark(scale = 0.5, fill = '#F4F2FF') {
  return `<svg viewBox="500 78 516 108" width="${516*scale}" height="${108*scale}" style="display:block">${WM.replace('#F4F2FF', fill)}</svg>`;
}
export const TUFT = ['#FF6B6B', '#FFD166', '#06D6A0', '#4D96FF', '#7C6CF5'];
export const BG = '#0e0e16';
export const baseCss = `
*{box-sizing:border-box;margin:0}
html,body{background:${BG}}
body{position:relative;overflow:hidden;font-family:-apple-system,"SF Pro Display","Segoe UI",Helvetica,Arial,sans-serif;color:#F4F2FF;-webkit-font-smoothing:antialiased}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(124,108,245,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(124,108,245,.07) 1px,transparent 1px);background-size:32px 32px;background-position:-1px -1px}
.glow{position:absolute;border-radius:50%;filter:blur(90px);background:rgba(124,108,245,.30)}
.px{position:absolute}
.frame{position:absolute;overflow:hidden;background:#060606;border-radius:16px;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 70px rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.4),0 0 0 1px rgba(0,0,0,.5)}
.frame img{position:absolute;max-width:none}
.m{position:absolute;backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);background:rgba(6,6,6,.5);border-radius:7px}
.mm{position:absolute;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);background:rgba(6,6,6,.78);border-radius:4px}
.t{position:absolute;background:#060606;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}
`;
export const IMG_W = 380; // css width of a crop image at scale 1
/**
 * panel: crop of a cropped frame image, css coords (crop px / 2).
 * o: {src, x,y (page pos), cx,cy,cw,ch (crop rect css), s (scale), masks:[{x,y,w,h,k}] in crop css coords, texts:[{x,y,w,h,fs,lh,text}], fade, radius}
 */
export function panel(o) {
  const s = o.s ?? 1;
  const sc = (v) => v * s;
  const maskHtml = (m) => {
    const px = (v) => `${sc(v)}px`;
    const box = `left:${px(m.x-o.cx)};top:${px(m.y-o.cy)};width:${px(m.w)};height:${px(m.h)}`;
    if (m.k === 'sk') {
      const bw = m.bw ?? m.w - 16, bh = m.bh ?? 10;
      const bx = m.al === 'l' ? 0 : (m.w - bw) / 2;
      return `<div style="position:absolute;background:#060606;${box}"></div><div style="position:absolute;background:#2b2b31;border-radius:${px(bh/2)};left:${px(m.x-o.cx+bx)};top:${px(m.y-o.cy+(m.h-bh)/2)};width:${px(bw)};height:${px(bh)}"></div>`;
    }
    if (m.k === 'tile') return `<div style="position:absolute;background:#060606;${box}"></div><div style="position:absolute;background:#2b2b31;border-radius:${px(7)};left:${px(m.x-o.cx+2)};top:${px(m.y-o.cy+2)};width:${px(m.w-4)};height:${px(m.h-4)}"></div>`;
    if (m.k === 'html') return `<div style="position:absolute;overflow:hidden;${box}"><div style="width:${m.w}px;height:${m.h}px;transform:scale(${s});transform-origin:0 0">${m.html}</div></div>`;
    return `<div class="${m.k === 'big' ? 'mm' : 'm'}" style="${box}"></div>`;
  };
  const masks = (o.masks || []).map(maskHtml).join('');
  const texts = (o.texts || []).map(t => `<div class="t" style="left:${sc(t.x-o.cx)}px;top:${sc(t.y-o.cy)}px;width:${sc(t.w)}px;height:${sc(t.h)}px;font-weight:${t.wt ?? 600};font-size:${sc(t.fs)}px;line-height:${sc(t.h)}px">${t.text}</div>`).join('');
  const fade = o.fade ? `-webkit-mask-image:linear-gradient(#000 calc(100% - ${o.fade}px),transparent);mask-image:linear-gradient(#000 calc(100% - ${o.fade}px),transparent);` : '';
  return `<div class="frame" style="left:${o.x}px;top:${o.y}px;width:${sc(o.cw)}px;height:${sc(o.ch)}px;border-radius:${o.radius ?? 16}px;${fade}${o.extra || ''}"><img src="crops/${o.src}.png" style="left:${-sc(o.cx)}px;top:${-sc(o.cy)}px;width:${sc(IMG_W)}px;height:${sc(720)}px">${masks}${texts}</div>`;
}
export function pixels(list) {
  return list.map(([x,y,c,sz=16,op=.55]) => `<div class="px" style="left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;background:${c};opacity:${op}"></div>`).join('');
}
export async function render(name, w, h, body, { omitBackground = false, file = name, outDir = OUT } = {}) {
  const html = `<!doctype html><meta charset=utf-8><style>${baseCss}body{width:${w}px;height:${h}px}</style><body>${body}</body>`;
  const f = `${D}/_${name}.html`;
  writeFileSync(f, html);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.goto('file://' + f);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${outDir}/${file}.png`, omitBackground });
  await b.close();
}
// Header hostname mask (css coords in a crop that starts at the panel top).
export const HOST = { x: 213, y: 11, w: 98, h: 30, k: 'sk' };
