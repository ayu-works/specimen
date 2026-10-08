import { useEffect, useState } from 'react';
import { Eyedropper } from '@/components/Eyedropper';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { type InspectorHover, send } from '@/lib/messaging';
import { useStore } from '../../store';
import { Blueprint } from './Blueprint';
import { Palette } from './Palette';
import { Shapes } from './Shapes';
import { Spacing } from './Spacing';
import { TypeScale } from './TypeScale';

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
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
    const onConnect = (port: chrome.runtime.Port) => {
      if (port.name !== 'inspector') return;
      port.onMessage.addListener((m: InspectorHover) => setHover(m));
    };
    chrome.runtime.onConnect.addListener(onConnect);
    return () => chrome.runtime.onConnect.removeListener(onConnect);
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
      <Toolbar />
      <Palette scan={scan} />
      <TypeScale scan={scan} />
      <Spacing scan={scan} />
      <Shapes scan={scan} />
      <Blueprint scan={scan} />
    </div>
  );
}
