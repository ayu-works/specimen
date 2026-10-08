import type { InspectorHover, Message } from '@/lib/messaging';
import { toHex } from './color';
import { type GridSpec, renderGrid } from './grid';

type OverlayMsg = Extract<Message, { type: 'overlay.set' }>;
const FLAG = '__specimenOverlay';

/** Mounts the overlay once per page; later injections just re-run the idempotent guard. */
export function initOverlay(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;margin:0;padding:0;border:0;';
  const root = host.attachShadow({ mode: 'closed' });
  const gridEl = document.createElement('div');
  gridEl.style.cssText = 'position:absolute;inset:0;display:none';
  const hoverBox = document.createElement('div');
  hoverBox.style.cssText =
    'position:absolute;display:none;outline:2px solid #5e6ad2;background:rgba(94,106,210,.15);box-sizing:border-box';
  const hlLayer = document.createElement('div');
  hlLayer.style.cssText = 'position:absolute;inset:0';
  root.append(gridEl, hlLayer, hoverBox);
  document.documentElement.append(host);

  let gridSpec: GridSpec | undefined;
  let tokens: { id: string; hex: string }[] = [];
  let port: chrome.runtime.Port | null = null;
  let inspecting = false;
  let raf = 0;
  let last: MouseEvent | null = null;
  let highlightHex: string | null = null;

  const redrawHighlights = () => {
    hlLayer.replaceChildren();
    if (!highlightHex) return;
    const nodes = document.body.querySelectorAll<HTMLElement>('*');
    let count = 0;
    for (const n of nodes) {
      if (count > 400) break;
      const cs = getComputedStyle(n);
      if (toHex(cs.color) === highlightHex || toHex(cs.backgroundColor) === highlightHex) {
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;outline:2px solid #ff4060;box-sizing:border-box`;
        hlLayer.append(b);
        count++;
      }
    }
  };

  const onFrame = () => {
    raf = 0;
    const e = last;
    if (!e || !inspecting) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === host) return;
    const r = el.getBoundingClientRect();
    hoverBox.style.cssText += `;display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    const cs = getComputedStyle(el);
    const styles: InspectorHover['styles'] = {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
      borderRadius: cs.borderRadius,
    };
    const matchedTokens: InspectorHover['matchedTokens'] = [];
    for (const prop of ['color', 'backgroundColor'] as const) {
      const hex = toHex(styles[prop]);
      const t = hex && tokens.find((x) => x.hex.toLowerCase() === hex);
      if (t) matchedTokens.push({ id: t.id, hex: t.hex, prop });
    }
    const payload: InspectorHover = {
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      tag: el.tagName.toLowerCase(),
      styles,
      matchedTokens,
    };
    try {
      port?.postMessage({ type: 'inspector.hover', ...payload });
    } catch {
      port = null;
    }
  };

  const onMove = (e: MouseEvent) => {
    last = e;
    if (!raf) raf = requestAnimationFrame(onFrame);
  };

  const setInspector = (on: boolean) => {
    if (on === inspecting) return;
    inspecting = on;
    if (on) {
      port = chrome.runtime.connect({ name: 'inspector' });
      port.onDisconnect.addListener(() => {
        port = null;
      });
      document.addEventListener('mousemove', onMove, true);
    } else {
      document.removeEventListener('mousemove', onMove, true);
      port?.disconnect();
      port = null;
      hoverBox.style.display = 'none';
    }
  };

  chrome.runtime.onMessage.addListener((msg: Message) => {
    if (!msg || msg.type !== 'overlay.set') return false;
    const m = msg as OverlayMsg;
    if (m.gridSpec) gridSpec = m.gridSpec;
    if (m.tokens) tokens = m.tokens;
    if (m.grid !== undefined) {
      gridEl.style.display = m.grid ? 'block' : 'none';
      if (m.grid) renderGrid(gridEl, gridSpec);
    }
    if (m.inspector !== undefined) setInspector(m.inspector);
    if (m.highlight !== undefined) {
      highlightHex = m.highlight?.hex?.toLowerCase() ?? null;
      redrawHighlights();
    }
    return false;
  });
  window.addEventListener('resize', () => {
    if (gridEl.style.display !== 'none') renderGrid(gridEl, gridSpec);
  });
}
