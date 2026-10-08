export interface GridSpec {
  containerMaxWidth: number | null;
  gutter: number | null;
  baseUnit: number;
}

/** Renders container edges, 12 columns and a baseline grid into `el` (fixed, viewport-sized). */
export function renderGrid(el: HTMLElement, spec: GridSpec | undefined): void {
  const baseUnit = spec?.baseUnit && spec.baseUnit > 0 ? spec.baseUnit : 8;
  const gutter = spec?.gutter ?? 24;
  const max = spec?.containerMaxWidth ?? Math.min(window.innerWidth, 1200);
  const width = Math.min(max, window.innerWidth);
  const cols = Array.from(
    { length: 12 },
    () => `<div style="flex:1;background:rgba(255,64,96,.12)"></div>`,
  ).join('');
  el.innerHTML = `
    <div style="position:absolute;inset:0;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${baseUnit - 1}px,rgba(64,128,255,.18) ${baseUnit - 1}px,rgba(64,128,255,.18) ${baseUnit}px)"></div>
    <div style="position:absolute;top:0;bottom:0;left:50%;width:${width}px;transform:translateX(-50%);
      border-left:1px dashed rgba(255,64,96,.8);border-right:1px dashed rgba(255,64,96,.8);
      display:flex;gap:${gutter}px;box-sizing:border-box">${cols}</div>`;
}
