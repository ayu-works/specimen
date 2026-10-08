import { counterpartKey, hasMeasuredCounterpart, mergeScans } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { FilePlus2, ScanLine } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { replaceStoredScan } from '@/lib/db';
import { ensureSiteAccess, friendlyScanError, sameUrl, scanTab } from '@/lib/scanFlow';
import {
  loadMobilePref,
  runExtras,
  runMediaCapture,
  runMobileCapture,
  saveMobilePref,
} from '../extras';
import { useStore } from '../store';

const bare = (host: string) => host.replace(/^www\./, '');

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right">{children}</span>
    </div>
  );
}

/** Mobile, dark/light mode and extra pages: one line each, one action each. */
function Captures({ scan }: { scan: DesignScan }) {
  const { extras, patchExtras, setScan } = useStore();
  const [mobilePref, setMobilePref] = useState(true);
  const mine = extras.scanId === scan.id;
  const key = counterpartKey(scan);
  const modeName = `${key === 'dark' ? 'Dark' : 'Light'} mode`;
  const pages = scan.meta.pages ?? [];

  useEffect(() => {
    void loadMobilePref().then(setMobilePref);
  }, []);

  const mobile = scan.variants?.mobile;
  const theme = hasMeasuredCounterpart(scan) ? 'measured' : mine ? extras.theme : 'idle';

  async function addPage() {
    patchExtras({ page: 'running', note: null });
    try {
      await ensureSiteAccess();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) {
        throw new Error('Open another page of this site in the current tab, then try again.');
      }
      if (bare(new URL(tab.url).host) !== bare(scan.host)) {
        throw new Error(`That tab is on ${new URL(tab.url).host}. Open a page of ${scan.host}.`);
      }
      if ((scan.meta.pages ?? [scan.url]).some((u) => sameUrl(u, tab.url))) {
        throw new Error('That page is already merged. Open a different page of the site.');
      }
      const out = await scanTab(tab.id, { save: false, noScreenshot: true });
      const merged = mergeScans([scan, out.scan]);
      setScan(merged);
      await replaceStoredScan(merged).catch(() => {});
      patchExtras({ page: 'idle', note: `${merged.meta.pages?.length ?? 2} pages merged` });
    } catch (e) {
      patchExtras({
        page: 'idle',
        note:
          e instanceof Error
            ? friendlyScanError(e.message).replace(/^Scan failed: /, '')
            : String(e),
      });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="captures">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={mobilePref}
          onChange={(e) => {
            setMobilePref(e.target.checked);
            void saveMobilePref(e.target.checked);
          }}
          className="size-3.5 accent-foreground"
        />
        Also capture mobile
      </label>
      {mine && extras.mobile === 'running' && (
        <p role="status" className="text-[11px] text-muted-foreground">
          Capturing mobile… a small window opens for a moment.
        </p>
      )}
      {mobile && extras.mobile !== 'running' && (
        <Row label="Mobile">
          <span>
            captured{mobile.hamburger ? ' · menu button' : ''}
            {mobile.viewportWidth ? ` · ${mobile.viewportWidth}px` : ''}
          </span>
        </Row>
      )}
      {!mobile && mine && extras.mobile !== 'running' && (
        <Row label="Mobile">
          <button type="button" className="underline" onClick={() => void runMobileCapture(scan)}>
            capture
          </button>
        </Row>
      )}
      {theme !== 'idle' && (
        <Row label={modeName}>
          {theme === 'running' && <span role="status">checking…</span>}
          {theme === 'measured' && <span>found · captured from the site</span>}
          {theme === 'none' && <span>not found</span>}
          {theme === 'failed' && <span>unavailable</span>}
          {theme === 'offer' && (
            <button type="button" className="underline" onClick={() => void runMediaCapture(scan)}>
              capture
            </button>
          )}
        </Row>
      )}
      {theme === 'offer' && (
        <p className="text-[11px] text-muted-foreground">
          This site follows your system setting. Capturing needs a one-time permission, and Chrome
          shows a "debugging this browser" bar for a few seconds.
        </p>
      )}
      {scan.host !== 'composed' && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void addPage()}
            disabled={extras.page === 'running'}
          >
            <FilePlus2 size={14} />
            {extras.page === 'running' ? 'Adding page…' : 'Add another page'}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Open another page of this site in your current tab, then click Add another page.
          </p>
        </>
      )}
      {pages.length > 1 && (
        <details className="text-xs" data-testid="pages-merged">
          <summary className="cursor-pointer font-medium">{pages.length} pages merged</summary>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {pages.map((u) => (
              <li key={u} className="truncate">
                {pathOf(u)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {mine && extras.note && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {extras.note}
        </p>
      )}
    </div>
  );
}

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
      void loadMobilePref().then((withMobile) =>
        runExtras(res.scan, tab.id as number, res.hints, withMobile),
      );
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
          <Captures scan={scan} />
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
