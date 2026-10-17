import { useEffect, useState } from 'react';
import { Eyedropper } from '@/components/Eyedropper';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type InspectorHover, send } from '@/lib/messaging';
import { useStore } from '../../store';
import { Accessibility } from './Accessibility';
import { Blueprint } from './Blueprint';
import { Components } from './Components';
import { Palette } from './Palette';
import { Shapes } from './Shapes';
import { Spacing } from './Spacing';
import { TypeScale } from './TypeScale';
import { VibeCard } from './Vibe';

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Only what the card reads: anything else on the port is dropped, never rendered. */
function isHover(m: unknown): m is InspectorHover {
  if (!m || typeof m !== 'object') return false;
  const h = m as { type?: unknown } & Partial<Record<keyof InspectorHover, unknown>>;
  const r = h.rect as Partial<Record<keyof InspectorHover['rect'], unknown>> | undefined;
  return (
    h.type === 'inspector.hover' &&
    !!r &&
    typeof r === 'object' &&
    typeof r.w === 'number' &&
    typeof r.h === 'number' &&
    typeof h.tag === 'string' &&
    !!h.styles &&
    typeof h.styles === 'object' &&
    Object.values(h.styles).every((v) => typeof v === 'string') &&
    Array.isArray(h.matchedTokens) &&
    h.matchedTokens.every((t) => typeof (t as { hex?: unknown })?.hex === 'string')
  );
}

/**
 * Listen for the overlay's `inspector` Ports until the returned detach() runs. Foreign Ports
 * (`council`, `llm`, …) are disconnected unread; posts after a disconnect or detach are dropped.
 */
export function attachInspector(onHover: (h: InspectorHover) => void): () => void {
  let live = true;
  const ports = new Map<chrome.runtime.Port, () => void>();
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch {
      // the port is already gone
    }
  };

  const onConnect = (port: chrome.runtime.Port) => {
    if (!live) return;
    if (port.name !== 'inspector') {
      // Safe: each receiving frame has its own end, so this only closes ours (the council host keeps its).
      safely(() => port.disconnect());
      return;
    }
    const onMessage = (m: unknown) => {
      if (live && ports.has(port) && isHover(m)) onHover(m);
    };
    const release = () => {
      ports.delete(port);
      safely(() => port.onMessage.removeListener(onMessage));
      safely(() => port.onDisconnect.removeListener(release));
    };
    ports.set(port, release);
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(release);
  };

  chrome.runtime.onConnect.addListener(onConnect);
  return () => {
    if (!live) return;
    live = false;
    safely(() => chrome.runtime.onConnect.removeListener(onConnect));
    for (const [port, release] of [...ports]) {
      release();
      safely(() => port.disconnect());
    }
  };
}

function Toolbar() {
  const scan = useStore((s) => s.scan);
  const [grid, setGrid] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [eye, setEye] = useState(false);
  const [hover, setHover] = useState<InspectorHover | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!inspect || typeof chrome === 'undefined' || !chrome.runtime?.onConnect) return;
    const detach = attachInspector(setHover);
    return () => {
      detach();
      setHover(null);
    };
  }, [inspect]);

  async function toggle(kind: 'grid' | 'inspector', on: boolean) {
    if (!scan) return;
    setErr('');
    try {
      const tabId = await activeTabId();
      if (tabId === undefined) throw new Error('No active tab');
      await send('overlay.set', {
        tabId,
        [kind]: on,
        gridSpec: {
          containerMaxWidth: scan.layout.containerMaxWidth,
          gutter: scan.layout.gutter,
          baseUnit: scan.spacing.baseUnit,
        },
        tokens: scan.colors.palette.map((t) => ({ id: t.id, hex: t.hex })),
      });
      if (kind === 'grid') setGrid(on);
      else setInspect(on);
    } catch (e) {
      setErr(`Overlay unavailable on this page (${e instanceof Error ? e.message : String(e)})`);
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={grid ? 'default' : 'outline'}
          onClick={() => toggle('grid', !grid)}
        >
          Grid
        </Button>
        <Button
          size="sm"
          variant={inspect ? 'default' : 'outline'}
          onClick={() => toggle('inspector', !inspect)}
        >
          Inspect
        </Button>
        <Button size="sm" variant={eye ? 'default' : 'outline'} onClick={() => setEye(!eye)}>
          Eyedropper
        </Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {eye && scan && <Eyedropper scan={scan} />}
      {inspect && (
        <div className="rounded-md bg-muted p-2 font-mono text-[11px]" data-testid="inspector-card">
          {hover ? (
            <>
              <div className="mb-1 font-semibold">
                {hover.tag} · {Math.round(hover.rect.w)}×{Math.round(hover.rect.h)}
              </div>
              {Object.entries(hover.styles).map(([k, v]) => (
                <div key={k} className="truncate">
                  <span className="text-muted-foreground">{k}:</span> {v}
                </div>
              ))}
              {hover.matchedTokens.length > 0 && (
                <div className="mt-1">
                  tokens: {hover.matchedTokens.map((t) => t.hex).join(', ')}
                </div>
              )}
            </>
          ) : (
            'Hover an element on the page…'
          )}
        </div>
      )}
    </Card>
  );
}

function OriginBanner() {
  const { scan, origin } = useStore();
  if (!scan || origin === 'tab') return null;
  return (
    <p
      className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground"
      data-testid="origin-banner"
    >
      {origin === 'composed'
        ? 'Composed design'
        : `Saved scan · ${new Date(scan.scannedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`}
    </p>
  );
}

export function Inspect() {
  const { scan, setTab } = useStore();
  if (!scan) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
        <p>Scan a page to inspect its design system.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <OriginBanner />
      <VibeCard />
      <Toolbar />
      <Palette scan={scan} />
      <Accessibility scan={scan} />
      <TypeScale scan={scan} />
      <Spacing scan={scan} />
      <Shapes scan={scan} />
      <Components scan={scan} />
      <Blueprint scan={scan} />
    </div>
  );
}
