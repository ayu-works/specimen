import type { DesignScan } from '@specimen/core/schema';
import { Card, CardTitle } from '@/components/ui/card';

export function Shapes({ scan }: { scan: DesignScan }) {
  const { radii, shadows, borders } = scan;
  return (
    <Card>
      <CardTitle>Shapes</CardTitle>
      <div className="flex flex-wrap gap-2">
        {radii.scale.map((r) => (
          <div key={r.value} className="flex flex-col items-center gap-1">
            <div
              className="size-11 border-2 border-foreground/60 bg-muted"
              style={{ borderRadius: Math.min(r.value, 22) }}
            />
            <span className="font-mono text-[10px] text-muted-foreground">
              {r.value >= 9999 ? 'pill' : `${r.value}px`}
            </span>
          </div>
        ))}
      </div>
      {shadows.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 rounded-md bg-muted/60 p-3">
          {shadows.map((s) => (
            <div key={s.css} className="flex flex-col items-center gap-1">
              <div className="size-11 rounded-md bg-background" style={{ boxShadow: s.css }} />
              <span className="font-mono text-[10px] text-muted-foreground">L{s.level}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {borders.map((b) => (
          <div key={`${b.width}-${b.colorRole}`} className="flex items-center gap-1.5 text-[11px]">
            <div className="w-8 bg-foreground" style={{ height: Math.max(1, b.width) }} />
            <span className="font-mono text-muted-foreground">{b.width}px</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
