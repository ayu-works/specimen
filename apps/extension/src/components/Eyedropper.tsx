import { deltaE2000 } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { Pipette } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

export function nearestToken(scan: DesignScan, hex: string) {
  const roleOf = new Map(Object.entries(scan.colors.roles).map(([r, id]) => [id, r]));
  let best: { hex: string; role?: string; dE: number } | null = null;
  for (const t of scan.colors.palette) {
    const dE = deltaE2000(hex, t.hex);
    if (!best || dE < best.dE) best = { hex: t.hex, role: roleOf.get(t.id), dE };
  }
  return best;
}

export function Eyedropper({ scan }: { scan: DesignScan }) {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const [picked, setPicked] = useState<string | null>(null);
  if (!Ctor)
    return <p className="text-xs text-muted-foreground">Eyedropper isn't supported here.</p>;
  const match = picked ? nearestToken(scan, picked) : null;

  async function pick() {
    try {
      const r = await new (Ctor as EyeDropperCtor)().open();
      setPicked(r.sRGBHex);
    } catch {
      /* cancelled */
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={pick}>
        <Pipette size={14} /> Pick
      </Button>
      {picked && match && (
        <div className="flex items-center gap-2 text-xs" data-testid="eyedropper-result">
          <span className="size-5 rounded border border-border" style={{ background: picked }} />
          <span className="font-mono">{picked}</span>
          <span className="text-muted-foreground">→</span>
          <span className="size-5 rounded border border-border" style={{ background: match.hex }} />
          <span className="font-mono">{match.hex}</span>
          {match.role && <span>{match.role}</span>}
          <span className="text-muted-foreground">ΔE {match.dE.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
