import { compose, FACET_LABELS, FACETS, type Facet } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type ComposeFacet, type StoredScan, saveCompose } from '@/lib/db';
import { useStore } from '../../store';
import { ComposePreview } from './ComposePreview';
import { formatDate } from './ScanCard';

const label = (s: StoredScan) => `${s.title || s.host} · ${formatDate(s.scannedAt)}`;

function Picker({
  id,
  value,
  scans,
  onChange,
  name,
}: {
  id: string;
  value: string;
  scans: StoredScan[];
  onChange: (v: string) => void;
  name: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-16 shrink-0 text-xs text-muted-foreground">
        {name}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 flex-1 truncate rounded-md border border-border bg-background px-1.5 text-xs"
      >
        {scans.map((s) => (
          <option key={s.id} value={s.id}>
            {label(s)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Compose({
  scans,
  initialBase,
  onExit,
  onSaved,
}: {
  scans: StoredScan[];
  initialBase: string | undefined;
  onExit: () => void;
  onSaved: () => void;
}) {
  const { openScan, setTab } = useStore();
  const [baseId, setBaseId] = useState(initialBase ?? scans[0]?.id ?? '');
  const [picks, setPicks] = useState<Partial<Record<Facet, string>>>({});
  const byId = useMemo(() => new Map(scans.map((s) => [s.id, s])), [scans]);
  const base = byId.get(baseId);

  const result = useMemo(() => {
    if (!base) return null;
    try {
      const sources: Partial<Record<Facet, DesignScan>> = {};
      for (const f of FACETS) {
        const s = byId.get(picks[f] ?? baseId);
        if (s) sources[f] = s;
      }
      return { scan: compose(sources, base), error: null };
    } catch (e) {
      return { scan: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [base, baseId, picks, byId]);

  const composed = result?.scan ?? null;

  async function save() {
    if (!composed) return;
    const sources = Object.fromEntries(FACETS.map((f) => [f, picks[f] ?? baseId])) as Record<
      ComposeFacet,
      string
    >;
    try {
      await saveCompose(
        { id: composed.id, name: composed.title, sources, createdAt: Date.now() },
        composed,
      );
      toast('Saved to Library');
      onSaved();
    } catch {
      toast('Could not save');
    }
  }

  function use() {
    if (!composed) return;
    openScan(composed, 'composed');
    setTab('generate');
  }

  return (
    <div className="flex flex-col gap-3" data-testid="compose-view">
      <button
        type="button"
        onClick={onExit}
        className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={12} /> Back to Library
      </button>
      {scans.length < 2 && (
        <p className="text-xs text-muted-foreground">Scan more sites to mix their styles.</p>
      )}
      <Card className="flex flex-col gap-2">
        <Picker
          id="compose-base"
          name="Start from"
          value={baseId}
          scans={scans}
          onChange={(v) => {
            setBaseId(v);
            setPicks({});
          }}
        />
        <div className="my-0.5 border-t border-border" />
        {FACETS.map((f) => (
          <Picker
            key={f}
            id={`compose-${f}`}
            name={FACET_LABELS[f]}
            value={picks[f] ?? baseId}
            scans={scans}
            onChange={(v) => setPicks((p) => ({ ...p, [f]: v === baseId ? undefined : v }))}
          />
        ))}
      </Card>
      {result?.error && (
        <p role="alert" className="rounded-md border border-destructive/40 p-2 text-destructive">
          Could not mix these: {result.error}
        </p>
      )}
      {composed && (
        <>
          <ComposePreview scan={composed} />
          {composed.meta.warnings.length > 0 && (
            <ul
              className="list-disc pl-4 text-[11px] text-muted-foreground"
              data-testid="compose-warnings"
            >
              {composed.meta.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <Button onClick={use} disabled={!composed}>
        Use this design
      </Button>
      <Button variant="outline" onClick={() => void save()} disabled={!composed}>
        Save
      </Button>
    </div>
  );
}
