import type { DesignScan } from '@specimen/core/schema';
import { Card, CardTitle } from '@/components/ui/card';

export function Spacing({ scan }: { scan: DesignScan }) {
  const { baseUnit, scale, sectionPaddingY, contentGap } = scan.spacing;
  const max = Math.max(...scale, 1);
  return (
    <Card>
      <CardTitle>Spacing</CardTitle>
      <div className="mb-2 text-xs text-muted-foreground">
        Base unit <span className="font-mono text-foreground">{baseUnit}px</span> · section padding{' '}
        <span className="font-mono text-foreground">{sectionPaddingY}px</span> · content gap{' '}
        <span className="font-mono text-foreground">{contentGap}px</span>
      </div>
      <div className="flex flex-col gap-1">
        {scale.map((v) => (
          <div key={v} className="flex items-center gap-2">
            <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">{v}</span>
            <div
              className="h-3 rounded-sm bg-primary/70"
              style={{ width: `${Math.max(2, (v / max) * 100)}%`, maxWidth: 'calc(100% - 2.5rem)' }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
