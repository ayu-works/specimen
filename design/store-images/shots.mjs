import { mascot, wordmark, panel, pixels, render, HOST, TUFT } from './lib.mjs';

const scatter = [[1120,40,TUFT[0]],[1216,92,TUFT[1],12],[1236,700,TUFT[2]],[1160,752,TUFT[3],12],[470,730,TUFT[4]],[500,36,TUFT[1],12],[24,420,TUFT[3],12],[40,760,TUFT[0]],[700,18,TUFT[2],12],[624,770,TUFT[1],12]];

function left({ mood, head, sub, extra = '' , hs = 60}) {
  return `<div class="grid"></div><div class="glow" style="left:690px;top:120px;width:560px;height:560px"></div>${pixels(scatter)}
  <div style="position:absolute;left:64px;top:52px">${wordmark(0.26)}</div>
  <div style="position:absolute;left:64px;top:170px;width:470px">
    <div style="margin-bottom:34px">${mascot(mood, 96)}</div>
    <div style="font-size:${hs}px;font-weight:800;line-height:1.04;letter-spacing:-.025em">${head}</div>
    <div style="margin-top:22px;font-size:23px;line-height:1.35;color:#C4C1E0;max-width:430px">${sub}</div>
    ${extra}
  </div>`;
}
const hl = (t) => `<span style="color:#A99BFF">${t}</span>`;
const CX = 10, CW = 354, CY = 3;
const host = [HOST];
const bar = (i) => `<i style="width:26px;height:4px;border-radius:2px;background:#d2d2d7"></i>`;
const wire = `<div style="width:313px;height:223px;background:#f5f5f7;position:relative;font-size:0">
<div style="height:16px;background:#fff;border-bottom:1px solid #e3e3e8;display:flex;align-items:center;gap:10px;padding:0 12px"><i style="width:9px;height:9px;border-radius:5px;background:#c7c7cc"></i>${bar()}${bar()}${bar()}</div>
<div style="position:absolute;left:78px;top:34px;width:157px;height:16px;border-radius:4px;background:#c7c7cc"></div>
<div style="position:absolute;left:58px;top:60px;width:197px;height:6px;border-radius:3px;background:#d8d8dd"></div>
<div style="position:absolute;left:88px;top:72px;width:137px;height:6px;border-radius:3px;background:#d8d8dd"></div>
<div style="position:absolute;left:119px;top:90px;width:75px;height:19px;border-radius:10px;background:#5b6b8c"></div>
${[0, 1, 2].map(i => `<div style="position:absolute;left:${16 + i * 98}px;top:128px;width:88px;height:80px;border-radius:7px;background:#fff;border:1px solid #e3e3e8"><div style="margin:10px;height:30px;border-radius:4px;background:#e6e6eb"></div><div style="margin:0 10px;height:5px;width:50px;border-radius:3px;background:#d8d8dd"></div><div style="margin:6px 10px;height:5px;width:36px;border-radius:3px;background:#e6e6eb"></div></div>`).join('')}
</div>`;
const scanMasks = [HOST,
  { x: 76, y: 116, w: 26, h: 26, k: 'tile' },
  { x: 108, y: 112, w: 120, h: 20, k: 'sk', bw: 100, al: 'l' },
  { x: 38, y: 157, w: 313, h: 223, k: 'html', html: wire }];

const shot = (file, name, mood, head, sub, panels, extra, hs) =>
  render(name, 1280, 800, left({ mood, head, sub, extra, hs }) + panels, { file });
const S = 1.25;
const P = (o) => panel({ x: 788, y: 40, cx: CX, cy: CY, cw: CW, ch: 700, s: S, masks: host, ...o });

await shot('screenshot-1-scan', 's1', 'scanning', `Scan any ${hl("website's")} design`, 'One click measures its colors, type, spacing and more.',
  panel({ x: 810, y: 28, cx: CX, cy: CY, cw: CW, ch: 652, s: 1.12, src: 'p03', masks: scanMasks }));
await shot('screenshot-2-palette', 's2', 'happy', `${hl('Colors')} with their roles`, 'Background, text, accent, border: every swatch labeled.', P({ src: 'p18' }));

const typeTexts = [
  { x: 38, y: 454, w: 300, h: 36, fs: 32, text: 'Headline' },
  { x: 38, y: 522, w: 300, h: 52, fs: 48, text: 'Display' },
  { x: 38, y: 606, w: 300, h: 36, fs: 32, text: 'Heading' },
  { x: 38, y: 676, w: 300, h: 26, fs: 19, wt: 400, text: 'Body text sample' },
];
await shot('screenshot-3-type-spacing', 's3', 'thinking', `${hl('Type, spacing')} and shapes, measured`, 'Real sizes, scales and radii, read straight from the page.',
  panel({ x: 548, y: 60, src: 'p15', cx: 26, cy: 326, cw: 335, ch: 377, s: 1.2, radius: 14, fade: 80,
    masks: [{ x: 36, y: 366, w: 100, h: 50, k: 'sk', bh: 0 }, { x: 38, y: 372, w: 60, h: 10, k: 'sk', bw: 56, bh: 9, al: 'l' }, { x: 38, y: 399, w: 80, h: 10, k: 'sk', bw: 78, bh: 9, al: 'l' }],
    texts: typeTexts })
  + panel({ x: 825, y: 175, src: 'p16', cx: 26, cy: 136, cw: 335, ch: 536, s: 1.25, radius: 14 }), undefined, 54);

await shot('screenshot-4-prompt', 's4', 'thinking', `A ${hl('prompt')} for your AI agent`, 'Paste it into Claude Code, Cursor, v0 or Lovable.', P({ src: 'p20' }));

await shot('screenshot-5-design-md', 's5', 'happy', `${hl('Copy.')} Paste. Build.`, 'A DESIGN.md your agent can follow.',
  panel({ x: 788, y: 16, cx: CX, cy: 58, cw: CW, ch: 647, s: 1.2, src: 'p26', radius: 16 }).replace('left:788px', 'left:800px'),
  `<div style="margin-top:36px;display:inline-flex;align-items:center;gap:12px;padding:11px 18px;border:1px solid rgba(169,155,255,.3);border-radius:999px;font-size:16px;color:#C4C1E0;background:rgba(124,108,245,.12)"><span style="display:flex;gap:4px">${TUFT.slice(0, 4).map(c => `<i style="width:8px;height:8px;background:${c};display:block"></i>`).join('')}</span>No account &middot; No tracking &middot; Open source</div>`, 64);
