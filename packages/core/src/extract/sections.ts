import type { ColorRole, DesignScan, RawPage, RawSample, Section, TypeStyle } from '../schema';
import type { SampleColors } from './colors';
import { inside, px, round } from './util';

type Kind = Section['kind'];

interface Ctx {
  raw: RawPage;
  perSample: SampleColors[];
  roleOf: (hex: string) => ColorRole | undefined;
  styles: TypeStyle[];
  baseSize: number;
}

const MEDIA = new Set(['img', 'svg', 'picture', 'video', 'canvas']);

/** Sibling boxes (same row, similar width) that each hold a heading and more text. */
function boxGroup(samples: RawSample[], vw: number): RawSample[] {
  const headings = samples.filter((s) => s.heading && s.heading >= 2);
  const boxes = samples.filter(
    (s) =>
      !s.heading &&
      !s.interactive &&
      s.rect[2] >= 120 &&
      s.rect[2] < vw * 0.7 &&
      s.rect[3] >= 60 &&
      headings.some((h) => inside(h.rect, s.rect)) &&
      samples.some(
        (t) => t !== s && !t.heading && (t.text?.len ?? 0) > 0 && inside(t.rect, s.rect),
      ),
  );
  const rows = new Map<string, RawSample[]>();
  for (const b of boxes) {
    const k = `${b.depth}|${Math.round(b.rect[1] / 8)}`;
    rows.set(k, [...(rows.get(k) ?? []), b]);
  }
  let best: RawSample[] = [];
  for (const row of rows.values()) {
    const w = row[0]?.rect[2] ?? 0;
    const same = row.filter((b) => Math.abs(b.rect[2] - w) <= w * 0.08);
    if (same.length > best.length) best = same;
  }
  return best;
}

function classify(
  sec: RawPage['sections'][number],
  samples: RawSample[],
  idx: number,
  ctx: Ctx,
  largestHeading: number,
  firstPost: number,
  heroIdx: number,
): { scores: Partial<Record<Kind, number>>; boxes: RawSample[] } {
  const vw = ctx.raw.viewport.w;
  const [, y, , h] = sec.rect;
  const sc: Partial<Record<Kind, number>> = { content: 0.3 };
  const set = (k: Kind, v: number) => {
    sc[k] = Math.max(sc[k] ?? 0, v);
  };
  const headings = samples.filter((s) => s.heading);
  const maxH = Math.max(0, ...headings.map((s) => px(s.s.fontSize) ?? 0));
  const buttons = samples.filter((s) => s.interactive === 'button');
  const inputs = samples.filter((s) => s.interactive === 'input');
  const links = samples.filter((s) => s.interactive === 'link');
  const boxes = boxGroup(samples, vw);
  const headingText = headings.map((s) => s.text?.snippet ?? '').join(' ');

  if (
    (sec.landmark === 'header' || sec.landmark === 'nav' || (y < 8 && h < 140)) &&
    h < 140 &&
    y < 8
  ) {
    set('nav', links.length >= 3 || sec.landmark ? 0.95 : 0.7);
  }
  if (sec.landmark === 'footer') set('footer', 0.97);
  else if (idx === ctx.raw.sections.length - 1 && links.length >= 8) set('footer', 0.7);

  if (idx === heroIdx) {
    set('hero', 0.75 + (maxH >= largestHeading * 0.95 ? 0.1 : 0) + (buttons.length > 0 ? 0.1 : 0));
  }

  const media = samples.filter((s) => MEDIA.has(s.tag) && s.rect[3] <= 80 && s.rect[3] >= 12);
  const rowMedia = new Map<number, RawSample[]>();
  for (const m of media)
    rowMedia.set(Math.round(m.rect[1] / 8), [
      ...(rowMedia.get(Math.round(m.rect[1] / 8)) ?? []),
      m,
    ]);
  for (const row of rowMedia.values()) {
    const hs = row.map((m) => m.rect[3]);
    if (
      row.length >= 4 &&
      Math.max(...hs) <= Math.min(...hs) * 1.35 &&
      headings.length <= 1 &&
      h < 400
    ) {
      set('logos', 0.8);
    }
  }

  const boxButtons = boxes.filter((b) => buttons.some((x) => inside(x.rect, b.rect))).length;
  const cardLike = boxes.length;
  if (cardLike >= 3) set('features', 0.7);
  if (cardLike >= 2 && boxButtons >= 2) {
    set('pricing', 0.85 + (/pric|plan/i.test(headingText) ? 0.1 : 0));
  } else if (/pric/i.test(headingText) && buttons.length >= 2) set('pricing', 0.6);

  const numerals = samples.filter(
    (s) =>
      !s.heading &&
      !s.interactive &&
      (s.text?.len ?? 0) > 0 &&
      (s.text?.len ?? 0) <= 12 &&
      (px(s.s.fontSize) ?? 0) >= ctx.baseSize * 1.4,
  );
  const numGroups = new Map<string, number>();
  for (const n of numerals) {
    const k = `${n.s.fontSize}|${n.s.fontWeight}`;
    numGroups.set(k, (numGroups.get(k) ?? 0) + 1);
  }
  if ([...numGroups.values()].some((c) => c >= 3) && boxButtons < 2) set('stats', 0.8);

  if (samples.some((s) => s.tag === 'blockquote')) set('testimonials', 0.9);

  const details = samples.filter((s) => s.tag === 'details' || s.tag === 'summary').length;
  const qHeads = headings.filter((s) => s.text?.snippet?.trim().endsWith('?')).length;
  if (details >= 3) set('faq', 0.9);
  else if (qHeads >= 3) set('faq', 0.8);
  else if (/faq|frequently|questions/i.test(headingText) && details > 0) set('faq', 0.85);

  const actions = buttons.length + inputs.length;
  const proseLen = samples
    .filter((s) => !s.heading && !s.interactive)
    .reduce((a, s) => a + (s.text?.len ?? 0), 0);
  if (
    headings.length >= 1 &&
    headings.length <= 3 &&
    proseLen <= 250 &&
    actions >= 1 &&
    actions <= 4 &&
    boxes.length < 2 &&
    h < 600 &&
    links.length < 8
  ) {
    set('cta', idx === firstPost ? 0.5 : 0.65);
  }
  return { scores: sc, boxes };
}

export function classifySections(ctx: Ctx): DesignScan['layout']['blueprint'] {
  const { raw } = ctx;
  const vw = raw.viewport.w;
  const bySection = new Map<number, RawSample[]>();
  for (const s of raw.samples) {
    const l = bySection.get(s.section) ?? [];
    l.push(s);
    bySection.set(s.section, l);
  }
  const largest = Math.max(
    0,
    ...raw.samples.filter((s) => s.heading).map((s) => px(s.s.fontSize) ?? 0),
  );
  const isNav = (sec: RawPage['sections'][number]) =>
    sec.rect[1] < 8 &&
    sec.rect[3] < 140 &&
    (sec.landmark === 'header' || sec.landmark === 'nav' || sec.index === 0);
  const firstPost = raw.sections.find((s) => !isNav(s))?.index ?? 0;

  // Hero = the section with the biggest text among the first three non-nav sections. Many
  // sites set their headline in a styled div, so any text sample counts, not only <h1>.
  const textSize = (smp: RawSample) =>
    smp.heading || (smp.text?.len ?? 0) > 0 ? (px(smp.s.fontSize) ?? 0) : 0;
  let heroIdx = -1;
  let heroSize = ctx.baseSize * 1.5;
  for (const sec of raw.sections.filter((x) => !isNav(x)).slice(0, 3)) {
    const size = Math.max(0, ...(bySection.get(sec.index) ?? []).map(textSize));
    if (size > heroSize) {
      heroSize = size;
      heroIdx = sec.index;
    }
  }

  return raw.sections.map((sec) => {
    const samples = bySection.get(sec.index) ?? [];
    const { scores, boxes } = classify(sec, samples, sec.index, ctx, largest, firstPost, heroIdx);
    const ranked = (Object.entries(scores) as [Kind, number][]).sort((a, b) => b[1] - a[1]);
    const [kind, top] = ranked[0] ?? ['unknown' as Kind, 0];
    const second = ranked[1]?.[1] ?? 0;

    // arrangement / columns
    let columns = 1;
    let arrangement: Section['arrangement'] = 'stack';
    const grid = samples
      .map((s) =>
        s.s.gridTemplateColumns && s.s.display?.includes('grid')
          ? s.s.gridTemplateColumns.split(/\s+/).filter(Boolean).length
          : 0,
      )
      .reduce((a, b) => Math.max(a, b), 0);
    columns = Math.max(grid, boxes.length, 1);
    if (kind === 'faq') arrangement = 'list';
    else if (columns >= 3) arrangement = 'grid';
    else if (columns === 2) arrangement = 'split';

    const centered =
      samples.some((s) => s.s.justifyContent === 'center') ||
      samples.some(
        (s) =>
          (s.text?.len ?? 0) > 20 &&
          s.rect[2] < sec.rect[2] * 0.7 &&
          Math.abs(s.rect[0] - (vw - s.rect[0] - s.rect[2])) < 8,
      );
    const out: Section = {
      index: sec.index,
      kind,
      y: sec.rect[1],
      height: sec.rect[3],
      arrangement,
      columns,
      align: centered ? 'center' : 'left',
      confidence: round(Math.max(0, Math.min(1, top - second)), 2),
    };
    const root = samples.find(
      (s, i) =>
        i >= 0 &&
        s.rect[0] === sec.rect[0] &&
        s.rect[1] === sec.rect[1] &&
        s.rect[3] === sec.rect[3],
    );
    if (root) {
      const c = ctx.perSample[root.i];
      const role = c ? ctx.roleOf(c.effBg) : undefined;
      if (role) out.bgRole = role;
    }
    const head = samples
      .filter((s) => s.heading)
      .sort((a, b) => (px(b.s.fontSize) ?? 0) - (px(a.s.fontSize) ?? 0))[0];
    if (head) {
      const size = px(head.s.fontSize) ?? 0;
      const style = ctx.styles.find(
        (t) => /^(display|h[1-4])$/.test(t.role) && Math.abs(t.size - size) < 0.5,
      );
      if (style) out.headingStyleId = style.id;
    }
    return out;
  });
}
