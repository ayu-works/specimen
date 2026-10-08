import { COMPONENT_LABELS } from '@specimen/core';
import type { ComponentSpec, DesignScan } from '@specimen/core/schema';
import { type CSSProperties, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type State = keyof ComponentSpec['states'];
const STATE_ORDER: State[] = ['hover', 'focus', 'active', 'disabled'];

const CSS_KEYS: Record<string, keyof CSSProperties> = {
  'background-color': 'backgroundColor',
  color: 'color',
  'border-color': 'borderColor',
  'border-width': 'borderWidth',
  'border-radius': 'borderRadius',
  padding: 'padding',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'box-shadow': 'boxShadow',
  outline: 'outline',
  'outline-color': 'outlineColor',
  'outline-width': 'outlineWidth',
  'outline-offset': 'outlineOffset',
  transform: 'transform',
  opacity: 'opacity',
  'text-decoration': 'textDecoration',
  'text-decoration-color': 'textDecorationColor',
  filter: 'filter',
};

function toStyle(props: Record<string, string>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const key = CSS_KEYS[k];
    if (key) out[key] = v;
  }
  return out as CSSProperties;
}

const SAMPLE_TEXT: Record<ComponentSpec['kind'], string> = {
  'button-primary': 'Get started',
  'button-secondary': 'Learn more',
  'button-ghost': 'Cancel',
  input: 'Email address',
  card: 'Card title',
  'nav-link': 'Pricing',
  badge: 'New',
};

/** A rendered mini sample in the measured styles; `state` overlays that state's declarations. */
function Sample({ spec, state }: { spec: ComponentSpec; state: State | null }) {
  const props = { ...spec.base, ...(state ? spec.states[state] : {}) };
  const style: CSSProperties = {
    ...toStyle(props),
    borderStyle: parseFloat(props['border-width'] ?? '0') > 0 ? 'solid' : 'none',
    boxSizing: 'border-box',
    transition: 'all 120ms ease',
    maxWidth: '100%',
    minHeight: spec.kind === 'card' ? 52 : undefined,
    width: spec.kind === 'card' || spec.kind === 'input' ? '100%' : undefined,
    display: 'inline-flex',
    alignItems: spec.kind === 'card' ? 'flex-start' : 'center',
    justifyContent: spec.kind === 'input' || spec.kind === 'card' ? 'flex-start' : 'center',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    cursor: state === 'disabled' ? 'not-allowed' : 'default',
  };
  if (spec.kind === 'nav-link') {
    style.padding = props.padding;
  }
  if (spec.kind === 'input') style.opacity = state === 'disabled' ? style.opacity : 0.9;
  return <span style={style}>{SAMPLE_TEXT[spec.kind]}</span>;
}

function Row({ spec, backdrop }: { spec: ComponentSpec; backdrop: string }) {
  const [pinned, setPinned] = useState<State | null>(null);
  const [hovering, setHovering] = useState(false);
  const available = STATE_ORDER.filter((s) => spec.states[s]);
  const state = pinned ?? (hovering && spec.states.hover ? 'hover' : null);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium">{COMPONENT_LABELS[spec.kind]}</span>
        <span className="flex gap-1">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={pinned === s}
              onClick={() => setPinned(pinned === s ? null : s)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px]',
                pinned === s ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
              )}
            >
              {s}
            </button>
          ))}
        </span>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover preview of the captured :hover styles */}
      <div
        className="flex items-center rounded-md border border-border p-2.5"
        style={{ background: backdrop }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <Sample spec={spec} state={state} />
      </div>
      {available.length === 0 && (
        <span className="text-[10px] text-muted-foreground">
          No state styles declared by the page.
        </span>
      )}
    </div>
  );
}

export function Components({ scan }: { scan: DesignScan }) {
  const specs = scan.components ?? [];
  const bgId = scan.colors.roles.background;
  const backdrop = scan.colors.palette.find((t) => t.id === bgId)?.hex ?? '#ffffff';
  return (
    <Card data-testid="components-card">
      <CardTitle>Components</CardTitle>
      {specs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No buttons, inputs or cards were measured for this scan. Scan the page again to capture
          them.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Measured from the page. Hover a sample, or pick a state, to preview it.
          </p>
          <div className="flex flex-col gap-2">
            {specs.map((spec) => (
              <Row key={spec.kind} spec={spec} backdrop={backdrop} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
