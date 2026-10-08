import { a11ySummary, computeA11y, pairLevel } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { Card, CardTitle } from '@/components/ui/card';
import { copyHex } from './Palette';

type Pair = NonNullable<DesignScan['a11y']>['pairs'][number];

const LEVEL_LABEL = { aa: 'AA', 'aa-large': 'AA large text only', fail: 'Fails' } as const;

function Preview({ fg, bg }: { fg: string; bg: string }) {
  return (
    <span
      className="inline-flex h-8 min-w-14 items-center justify-center rounded border border-border px-2 text-sm font-semibold"
      style={{ color: fg, background: bg }}
    >
      Aa
    </span>
  );
}

function Failing({ pair }: { pair: Pair }) {
  const level = pairLevel(pair);
  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border border-border p-2"
      data-testid="a11y-fail"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {pair.fgRole ?? 'foreground'} on {pair.bgRole ?? 'background'}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {pair.ratio.toFixed(2)}:1 · {LEVEL_LABEL[level]}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Preview fg={pair.fg} bg={pair.bg} />
        {pair.fix && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <Preview fg={pair.fix} bg={pair.bg} />
            <button
              type="button"
              onClick={() => copyHex(pair.fix as string)}
              className="rounded border border-border px-1.5 py-1 font-mono text-[11px] hover:bg-muted"
              title="Copy the suggested color"
            >
              {pair.fix}
            </button>
          </>
        )}
        {!pair.fix && (
          <span className="text-[11px] text-muted-foreground">No close fix found.</span>
        )}
      </div>
    </li>
  );
}

export function Accessibility({ scan }: { scan: DesignScan }) {
  const withPairs = scan.a11y ? scan : { ...scan, a11y: computeA11y(scan.colors) };
  const sum = a11ySummary(withPairs);
  if (sum.total === 0) return null;
  const passing = (withPairs.a11y?.pairs ?? []).filter((p) => p.aa);
  return (
    <Card data-testid="a11y-card">
      <CardTitle>Accessibility</CardTitle>
      <p className="mb-2 text-sm" data-testid="a11y-summary">
        <span className="font-semibold">
          {sum.passing} of {sum.total}
        </span>{' '}
        color pairs pass AA
      </p>
      {sum.failing.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sum.failing.map((p) => (
            <Failing key={`${p.fgRole}-${p.bgRole}`} pair={p} />
          ))}
        </ul>
      )}
      {sum.failing.length === 0 && (
        <p className="text-xs text-muted-foreground">Every text and border pair meets WCAG AA.</p>
      )}
      {passing.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Passing pairs ({passing.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {passing.map((p) => (
              <li key={`${p.fgRole}-${p.bgRole}`} className="flex items-center gap-2">
                <Preview fg={p.fg} bg={p.bg} />
                <span className="truncate">
                  {p.fgRole} on {p.bgRole} · {p.ratio.toFixed(2)}:1
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
