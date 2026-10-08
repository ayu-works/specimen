import { firstHex } from '@specimen/core';
import type { ColorRole } from '@specimen/core/schema';
import { MoreHorizontal, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { deleteScans, type StoredScan, updateScan } from '@/lib/db';
import { cn } from '@/lib/utils';

const SWATCH_ROLES: ColorRole[] = ['background', 'surface', 'textPrimary', 'accent', 'border'];

export const formatDate = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function Swatches({ scan }: { scan: StoredScan }) {
  return (
    <div className="flex gap-1">
      {SWATCH_ROLES.map((r) => (
        <span
          key={r}
          title={r}
          className="size-3.5 rounded-full border border-border"
          style={{ background: firstHex(scan, r) ?? 'transparent' }}
        />
      ))}
    </div>
  );
}

interface Props {
  scan: StoredScan;
  thumb: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRescan: () => void;
  onChanged: () => void;
}

export function ScanCard({ scan, thumb, selected, onSelect, onOpen, onRescan, onChanged }: Props) {
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<'title' | 'tags' | null>(null);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  function begin(kind: 'title' | 'tags') {
    setMenu(false);
    setDraft(kind === 'title' ? scan.title : scan.tags.join(', '));
    setEdit(kind);
  }

  async function commit() {
    const kind = edit;
    setEdit(null);
    if (kind === 'title') {
      const title = draft.trim();
      if (title && title !== scan.title) await updateScan(scan.id, { title });
    } else if (kind === 'tags') {
      const tags = [
        ...new Set(
          draft
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
      await updateScan(scan.id, { tags });
    }
    onChanged();
  }

  async function toggleFavorite() {
    setMenu(false);
    await updateScan(scan.id, { favorite: !scan.favorite });
    onChanged();
  }

  async function remove() {
    setMenu(false);
    if (!window.confirm(`Delete "${scan.title || scan.host}" from your Library?`)) return;
    await deleteScans([scan.id]);
    onChanged();
  }

  const itemCls = 'block w-full px-3 py-1.5 text-left text-xs hover:bg-muted';
  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-background',
        selected ? 'border-foreground' : 'border-border',
      )}
      data-testid="library-card"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${scan.title || scan.host}`}
        className="block aspect-[16/10] w-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover object-top" />
        ) : (
          <span
            className="flex size-full items-center justify-center text-2xl font-semibold"
            style={{
              background: firstHex(scan, 'background') ?? undefined,
              color: firstHex(scan, 'accent', 'textPrimary') ?? undefined,
            }}
          >
            Aa
          </span>
        )}
      </button>
      <input
        type="checkbox"
        checked={selected}
        onChange={onSelect}
        aria-label="Select for export"
        className="absolute left-1.5 top-1.5 size-4 accent-foreground"
      />
      <div className="flex flex-col gap-1 p-2">
        {edit ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: inline edit opened by an explicit menu action
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit();
              if (e.key === 'Escape') setEdit(null);
            }}
            placeholder={edit === 'tags' ? 'tag, another tag' : 'Title'}
            aria-label={edit === 'tags' ? 'Tags, comma separated' : 'Title'}
            className="h-7 min-w-0 rounded border border-border bg-background px-1.5 text-xs"
          />
        ) : (
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">
                {scan.favorite && <Star size={10} className="mr-0.5 inline fill-current" />}
                {scan.title || scan.host}
              </div>
              <div className="truncate text-[10px] text-muted-foreground">
                {scan.host === 'composed' ? '' : `${scan.host} · `}
                {formatDate(scan.scannedAt)}
              </div>
            </div>
            <div ref={box} className="relative shrink-0">
              <button
                type="button"
                aria-label="More actions"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
                className="rounded p-0.5 hover:bg-muted"
              >
                <MoreHorizontal size={14} />
              </button>
              {menu && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={itemCls}
                    onClick={() => begin('title')}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={itemCls}
                    onClick={() => begin('tags')}
                  >
                    Tags
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={itemCls}
                    onClick={toggleFavorite}
                  >
                    {scan.favorite ? 'Unfavorite' : 'Favorite'}
                  </button>
                  {scan.host !== 'composed' && (
                    <button
                      type="button"
                      role="menuitem"
                      className={itemCls}
                      onClick={() => {
                        setMenu(false);
                        onRescan();
                      }}
                    >
                      Re-scan
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={cn(itemCls, 'text-destructive')}
                    onClick={remove}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        <Swatches scan={scan} />
        {scan.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {scan.tags.map((t) => (
              <span key={t} className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
