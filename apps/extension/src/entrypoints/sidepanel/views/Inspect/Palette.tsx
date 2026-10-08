import { counterpartColors, counterpartKey, detectScheme } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import { useMemo, useState } from 'react';
import { toast } from '@/components/toast';
import { Card, CardTitle } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function copyHex(hex: string) {
  navigator.clipboard
    .writeText(hex)
    .then(() => toast(`Copied ${hex}`))
    .catch(() => toast('Copy failed'));
}

export function Palette({ scan }: { scan: DesignScan }) {
  const [alt, setAlt] = useState(false);
  const counterpart = useMemo(() => counterpartColors(scan), [scan]);
  const { palette, roles } = alt ? counterpart : scan.colors;
  const baseScheme = detectScheme(scan.colors);
  const otherScheme = counterpartKey(scan);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const byId = new Map(palette.map((t) => [t.id, t]));
  const roleEntries = Object.entries(roles).flatMap(([role, id]) => {
    const t = id ? byId.get(id) : undefined;
    return t ? [{ role, token: t }] : [];
  });
  const roleIds = new Set(roleEntries.map((r) => r.token.id));
  const rest = alt ? [] : palette.filter((t) => !roleIds.has(t.id));
  const max = Math.max(...palette.map((t) => t.weight), 0.0001);

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <CardTitle className="mb-0">Palette</CardTitle>
        <fieldset
          aria-label="Theme preview"
          className="m-0 flex min-w-0 gap-0.5 rounded-md border-0 bg-muted p-0.5"
        >
          {(baseScheme === 'light'
            ? [
                { id: false, name: baseScheme },
                { id: true, name: otherScheme },
              ]
            : [
                { id: true, name: otherScheme },
                { id: false, name: baseScheme },
              ]
          ).map((o) => (
            <button
              key={o.name}
              type="button"
              aria-pressed={alt === o.id}
              onClick={() => setAlt(o.id)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                alt === o.id ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {cap(o.name)}
            </button>
          ))}
        </fieldset>
      </div>
      {alt && (
        <p className="mb-2 text-[10px] text-muted-foreground">
          Derived {otherScheme} counterpart (not measured from the site).
        </p>
      )}
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
      {!alt && (
        <div className="mt-3 flex h-2 overflow-hidden rounded">
          {palette.map((t) => (
            <div key={t.id} style={{ background: t.hex, flexGrow: t.weight / max }} />
          ))}
        </div>
      )}
    </Card>
  );
}
