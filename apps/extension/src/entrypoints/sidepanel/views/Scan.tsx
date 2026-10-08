import { ScanLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ensureSiteAccess, friendlyScanError, scanTab } from '@/lib/scanFlow';
import { useStore } from '../store';

export function Scan() {
  const { scan, screenshot, favicon, status, error, start, succeed, fail, setTab } = useStore();

  async function run() {
    start();
    try {
      await ensureSiteAccess();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('No active tab');
      if (tab.url && !/^https?:/.test(tab.url)) throw new Error(`Unsupported page: ${tab.url}`);
      const res = await scanTab(tab.id);
      succeed(res.scan, res.screenshot, tab.favIconUrl ?? null);
    } catch (e) {
      fail(friendlyScanError(e instanceof Error ? e.message : String(e)));
    }
  }

  const scanning = status === 'scanning';
  return (
    <div className="flex flex-col gap-3">
      {!scan && (
        <Button size="lg" className="h-14 text-base" onClick={run} disabled={scanning}>
          <ScanLine size={18} />
          {scanning ? 'Scanning…' : 'Scan this page'}
        </Button>
      )}
      {scanning && (
        <div className="h-1 overflow-hidden rounded bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
        </div>
      )}
      {status === 'error' && error && (
        <p role="alert" className="rounded-md border border-destructive/40 p-2 text-destructive">
          {error}
        </p>
      )}
      {scan && (
        <Card className="flex flex-col gap-2.5" data-testid="scan-result">
          <div className="flex items-center gap-2">
            {favicon ? (
              <img src={favicon} alt="" className="size-6 rounded" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded bg-muted text-xs font-semibold uppercase">
                {scan.host.charAt(0)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{scan.host}</div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(scan.scannedAt).toLocaleTimeString()} ·{' '}
                <span data-testid="sample-count">{scan.meta.sampleCount}</span> samples
              </div>
            </div>
          </div>
          {screenshot && (
            <img
              src={screenshot}
              alt="Page thumbnail"
              className="w-full rounded border border-border"
            />
          )}
          {scan.meta.warnings.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                <Badge>{scan.meta.warnings.length} warnings</Badge>
              </summary>
              <ul className="mt-1.5 list-disc pl-4">
                {scan.meta.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <Button onClick={() => setTab('generate')}>Generate prompt</Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setTab('inspect')}>
              Inspect
            </Button>
            <Button variant="outline" onClick={run} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Re-scan'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
