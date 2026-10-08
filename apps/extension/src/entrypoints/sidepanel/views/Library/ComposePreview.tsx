import { cssRadius, familyByRole, firstHex, levelShadows, primaryRadius } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';

/** Live mini-page rendered with the composed tokens (system fonts unless the stack has them). */
export function ComposePreview({ scan }: { scan: DesignScan }) {
  const bg = firstHex(scan, 'background') ?? '#ffffff';
  const surface = firstHex(scan, 'surface', 'surfaceAlt') ?? bg;
  const text = firstHex(scan, 'textPrimary') ?? '#111111';
  const sub = firstHex(scan, 'textSecondary', 'textMuted') ?? text;
  const accent = firstHex(scan, 'accent') ?? text;
  const onAccent = firstHex(scan, 'accentForeground') ?? bg;
  const border = firstHex(scan, 'border') ?? sub;
  const display = familyByRole(scan, 'display')?.stack;
  const body = familyByRole(scan, 'body')?.stack;
  const heading = scan.typography.styles.find((s) => s.role === 'h1' || s.role === 'display');
  const base = scan.typography.baseSize || 16;
  const unit = scan.spacing.baseUnit || 8;
  const radius = cssRadius(primaryRadius(scan));
  const cardRadius = cssRadius(scan.radii.card ?? primaryRadius(scan));
  const shadow = levelShadows(scan)[0]?.css;
  const bw = scan.borders[0]?.width ?? 1;

  return (
    <div
      data-testid="compose-preview"
      className="overflow-hidden rounded-lg border border-border"
      style={{ background: bg, color: text, fontFamily: body, padding: unit * 3 }}
    >
      <h4
        style={{
          fontFamily: display,
          fontSize: Math.min(30, Math.max(20, (heading?.size ?? 32) * 0.7)),
          fontWeight: heading?.weight ?? 600,
          lineHeight: heading?.lineHeight ?? 1.15,
          letterSpacing: `${heading?.letterSpacingEm ?? 0}em`,
          margin: 0,
        }}
      >
        Design that feels intentional
      </h4>
      <p style={{ color: sub, fontSize: Math.min(base, 15), margin: `${unit}px 0 ${unit * 2}px` }}>
        A short supporting line that shows the body font, size and secondary text color.
      </p>
      <div style={{ display: 'flex', gap: unit, flexWrap: 'wrap' }}>
        <span
          style={{
            background: accent,
            color: onAccent,
            borderRadius: radius,
            padding: `${unit}px ${unit * 2}px`,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Primary
        </span>
        <span
          style={{
            border: `${bw}px solid ${border}`,
            color: text,
            borderRadius: radius,
            padding: `${unit}px ${unit * 2}px`,
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Secondary
        </span>
      </div>
      <div
        style={{
          marginTop: unit * 2,
          background: surface,
          border: `${bw}px solid ${border}`,
          borderRadius: cardRadius,
          boxShadow: shadow,
          padding: unit * 2,
        }}
      >
        <div style={{ fontFamily: display, fontWeight: 600, fontSize: 14 }}>Card title</div>
        <div style={{ color: sub, fontSize: 12, marginTop: unit / 2 }}>
          Surface, border, radius and shadow come from the mix.
        </div>
      </div>
    </div>
  );
}
