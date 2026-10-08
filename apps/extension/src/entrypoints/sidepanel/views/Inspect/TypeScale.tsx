import type { DesignScan } from '@specimen/core/schema';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';

export function TypeScale({ scan }: { scan: DesignScan }) {
  const { families, styles } = scan.typography;
  const fam = new Map(families.map((f) => [f.id, f]));
  return (
    <Card>
      <CardTitle>Type</CardTitle>
      <div className="mb-3 flex flex-col gap-1">
        {families.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{f.name}</span>
            <span className="flex gap-1">
              <Badge>{f.role}</Badge>
              <Badge>{f.source}</Badge>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-border">
        {styles.map((s) => (
          <div key={s.id} className="py-2">
            <div className="mb-1 font-mono text-[10px] text-muted-foreground">
              {s.role} · {s.size}px · {s.weight} · lh {s.lineHeight}
            </div>
            <div
              className="truncate"
              style={{
                fontFamily: fam.get(s.familyId)?.stack,
                fontSize: Math.min(s.size, 40),
                fontWeight: s.weight,
                lineHeight: s.lineHeight,
                letterSpacing: `${s.letterSpacingEm}em`,
                textTransform: s.transform,
              }}
            >
              {s.sample ?? 'The quick brown fox'}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
