import type { DesignScan } from '@specimen/core/schema';
import { toast } from '@/components/toast';
import { Card, CardTitle } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';

export function copyHex(hex: string) {
  navigator.clipboard
    .writeText(hex)
    .then(() => toast(`Copied ${hex}`))
    .catch(() => toast('Copy failed'));
}

export function Palette({ scan }: { scan: DesignScan }) {
  const { palette, roles } = scan.colors;
  const byId = new Map(palette.map((t) => [t.id, t]));
  const roleEntries = Object.entries(roles).flatMap(([role, id]) => {
    const t = id ? byId.get(id) : undefined;
    return t ? [{ role, token: t }] : [];
  });
  const roleIds = new Set(roleEntries.map((r) => r.token.id));
  const rest = palette.filter((t) => !roleIds.has(t.id));
  const max = Math.max(...palette.map((t) => t.weight), 0.0001);

  return (
    <Card>
      <CardTitle>Palette</CardTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {roleEntries.map(({ role, token }) => (
          <button
            key={role}
            type="button"
            onClick={() => copyHex(token.hex)}
            className="flex items-center gap-2 rounded-md border border-border p-1.5 text-left hover:bg-muted"
          >
            <span
              className="size-7 shrink-0 rounded border border-border"
              style={{ background: token.hex }}
            />
            <span className="min-w-0">
              <span className="block truncate text-[11px] text-muted-foreground">{role}</span>
              <span className="block font-mono text-xs">{token.hex}</span>
            </span>
          </button>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {rest.map((t) => (
            <Tooltip key={t.id} label={`${t.hex} · ${(t.weight * 100).toFixed(1)}%`}>
              <button
                type="button"
                onClick={() => copyHex(t.hex)}
                aria-label={t.hex}
                className="size-8 rounded border border-border"
                style={{ background: t.hex }}
              />
            </Tooltip>
          ))}
        </div>
      )}
      <div className="mt-3 flex h-2 overflow-hidden rounded">
        {palette.map((t) => (
          <div key={t.id} style={{ background: t.hex, flexGrow: t.weight / max }} />
        ))}
      </div>
    </Card>
  );
}
