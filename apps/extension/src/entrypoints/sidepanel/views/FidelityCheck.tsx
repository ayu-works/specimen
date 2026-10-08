import { diffScans, FACET_NAMES, type FidelityReport, generateFixPrompt } from '@specimen/core';
import { ClipboardCopy, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ensureSiteAccess, friendlyScanError, sameUrl, scanTab } from '@/lib/scanFlow';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const FACET_ORDER = ['colors', 'typography', 'spacing', 'shape', 'layout'] as const;
const TOP_DELTAS = 5;

function tone(score: number): { text: string; bar: string; label: string } {
  if (score >= 85) return { text: 'text-emerald-600', bar: 'bg-emerald-500', label: 'Very close' };
  if (score >= 65) return { text: 'text-amber-600', bar: 'bg-amber-500', label: 'Getting there' };
  return { text: 'text-red-600', bar: 'bg-red-500', label: 'Needs work' };
}

const SEVERITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-muted-foreground/50' };

function ScoreRing({ score }: { score: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const t = tone(score);
  return (
    <div className={cn('relative size-28 shrink-0', t.text)} data-testid="fidelity-score">
      <svg
        viewBox="0 0 100 100"
        className="size-full -rotate-90"
        role="img"
        aria-label={`Score ${score} out of 100`}
      >
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold leading-none tabular-nums">{score}</span>
        <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          of 100
        </span>
      </div>
    </div>
  );
}

/** "Built it? Check your build": scan the active tab as the build and compare it to the target. */
export function FidelityCheck() {
  const { scan, checkPending, clearCheck } = useStore();
  const [report, setReport] = useState<FidelityReport | null>(null);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [buildHost, setBuildHost] = useState('');
  const [running, setRunning] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [flash, setFlash] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // A new target invalidates the previous result.
  useEffect(() => {
    if (scan && checkedFor !== null && checkedFor !== scan.id) {
      setReport(null);
      setCheckedFor(null);
    }
  }, [scan, checkedFor]);

  useEffect(() => {
    if (!checkPending) return;
    clearCheck();
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlash(true);
    setTimeout(() => setFlash(false), 1600);
  }, [checkPending, clearCheck]);

  if (!scan) return null;
  const target = scan;

  async function check() {
    setWarn(null);
    setError(null);
    try {
      await ensureSiteAccess();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) {
        throw new Error(
          'Open your build (for example http://localhost:3000) in this window first.',
        );
      }
      if (sameUrl(tab.url, target.url)) {
        setWarn('Switch to the tab with your build.');
        return;
      }
      setRunning(true);
      const out = await scanTab(tab.id, { save: false, noScreenshot: true });
      setReport(diffScans(target, out.scan));
      setCheckedFor(target.id);
      setBuildHost(out.scan.host);
      setAll(false);
    } catch (e) {
      setError(
        friendlyScanError(e instanceof Error ? e.message : String(e)).replace(/^Scan failed: /, ''),
      );
    } finally {
      setRunning(false);
    }
  }

  async function copyFix() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(generateFixPrompt(report, target).content);
      toast('Copied fix prompt');
    } catch {
      toast('Copy failed');
    }
  }

  const shown = report ? (all ? report.deltas : report.deltas.slice(0, TOP_DELTAS)) : [];
  return (
    <div ref={box} data-testid="fidelity-card">
      <Card className={cn('flex flex-col gap-3 transition-shadow', flash && 'ring-2 ring-ring')}>
        <div>
          <CardTitle className="mb-1">Built it? Check your build</CardTitle>
          <p className="text-xs text-muted-foreground">
            Open your build (for example localhost:3000) in this window, then click Check.
          </p>
        </div>
        <Button onClick={() => void check()} disabled={running}>
          <ScanSearch size={14} />
          {running ? 'Checking…' : report ? 'Check again' : 'Check'}
        </Button>
        {warn && (
          <p role="alert" className="rounded-md border border-amber-500/50 p-2 text-xs">
            {warn}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 p-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        {report && (
          <div className="flex flex-col gap-3" data-testid="fidelity-report">
            <div className="flex items-center gap-3">
              <ScoreRing score={report.score} />
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-semibold', tone(report.score).text)}>
                  {tone(report.score).label}
                </div>
                <p className="mb-2 truncate text-[11px] text-muted-foreground">
                  {buildHost} vs the target design
                </p>
                <div className="flex flex-col gap-1.5">
                  {FACET_ORDER.map((f) => {
                    const v = report.facets[f].score;
                    return (
                      <div key={f} className="flex items-center gap-2 text-[11px]">
                        <span className="w-14 shrink-0 text-muted-foreground">
                          {FACET_NAMES[f]}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                          <div
                            className={cn('h-full rounded', tone(v).bar)}
                            style={{ width: `${v}%` }}
                          />
                        </div>
                        <span className="w-6 text-right tabular-nums">{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {report.deltas.length === 0 ? (
              <p className="text-xs text-muted-foreground">No meaningful differences. Nice work.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  What to fix first
                </div>
                <ol className="flex flex-col gap-1.5" data-testid="fidelity-deltas">
                  {shown.map((d) => (
                    <li
                      key={`${d.facet}-${d.item}`}
                      className="flex gap-2 rounded-md border border-border p-2 text-xs"
                    >
                      <span
                        title={`${d.severity} priority`}
                        className={cn(
                          'mt-1 size-2 shrink-0 rounded-full',
                          SEVERITY_DOT[d.severity],
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{d.item}</span>
                        <span className="block text-muted-foreground">{d.hint}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {report.deltas.length > TOP_DELTAS && (
                  <button
                    type="button"
                    className="self-start text-[11px] text-muted-foreground underline"
                    onClick={() => setAll(!all)}
                  >
                    {all ? 'Show fewer' : `Show all ${report.deltas.length}`}
                  </button>
                )}
              </div>
            )}
            <Button variant="outline" onClick={() => void copyFix()}>
              <ClipboardCopy size={14} />
              Copy fix prompt
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
