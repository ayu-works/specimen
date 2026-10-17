import { Download, Layers, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mascot } from '@/components/Mascot';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  countScans,
  deleteScans,
  LIBRARY_SOFT_CAP,
  listScans,
  type StoredScan,
  thumbBlobs,
  thumbDataUrl,
} from '@/lib/db';
import { onLibraryChanged } from '@/lib/libraryChannel';
import { buildExport, downloadText, exportFilename, importFile } from '@/lib/libraryIO';
import { ensureSiteAccess, friendlyScanError, rescanUrl } from '@/lib/scanFlow';
import { useStore } from '../../store';
import { Compose } from './Compose';
import { ScanCard } from './ScanCard';

const KEY_CAP_ASKED = 'settings.libraryCapAsked';
const UNAVAILABLE = 'The Library is unavailable in this browser profile.';

async function capAlreadyAsked(): Promise<boolean> {
  try {
    return Boolean((await chrome.storage.local.get(KEY_CAP_ASKED))[KEY_CAP_ASKED]);
  } catch {
    return true;
  }
}

export function Library() {
  const { scan: current, openScan, setTab, requestCheck } = useStore();
  const [scans, setScans] = useState<StoredScan[] | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'browse' | 'compose'>('browse');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overCap, setOverCap] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  /** Index of a card just deleted: focus goes to the card now in its place (or the one before). */
  const refocus = useRef<number | null>(null);

  /** Bumped by each re-list: only the newest one applies, so overlapping re-lists can't land out of order. */
  const generation = useRef(0);
  /** The object URL of each shown thumbnail. A scan's thumbnail never changes under its id, so a re-list keeps it. */
  const urls = useRef(new Map<string, string>());
  /** A list was shown once: a later re-list that fails keeps it instead of emptying the Library. */
  const loaded = useRef(false);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const [list, blobs] = await Promise.all([listScans(), thumbBlobs()]);
      // Superseded before any object URL was made, so there is nothing to revoke.
      if (gen !== generation.current) return;
      const next = new Map<string, string>();
      for (const [id, b] of blobs) next.set(id, urls.current.get(id) ?? URL.createObjectURL(b));
      for (const [id, u] of urls.current) if (!next.has(id)) URL.revokeObjectURL(u);
      urls.current = next;
      loaded.current = true;
      setScans(list);
      setThumbs(next);
      setSelected((sel) => new Set([...sel].filter((id) => list.some((s) => s.id === id))));
      setError((e) => (e === UNAVAILABLE ? null : e));
    } catch {
      if (gen !== generation.current || loaded.current) return;
      setScans([]);
      setError(UNAVAILABLE);
    }
  }, []);

  useEffect(() => {
    void reload();
    void (async () => {
      if ((await countScans()) > LIBRARY_SOFT_CAP && !(await capAlreadyAsked())) setOverCap(true);
    })().catch(() => {});
  }, [reload]);

  // Another panel (another window) wrote to the Library: re-list. Cards keep their own edit state.
  useEffect(() => {
    const off = onLibraryChanged(() => void reload());
    return () => {
      off();
      generation.current++; // a re-list still in flight makes no object URLs after unmount
    };
  }, [reload]);

  // Release object URLs on unmount.
  useEffect(
    () => () => {
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current = new Map();
    },
    [],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!scans) return [];
    if (!q) return scans;
    return scans.filter((s) =>
      [s.host, s.title, s.url, ...s.tags].some((v) => v.toLowerCase().includes(q)),
    );
  }, [scans, query]);

  useEffect(() => {
    const at = refocus.current;
    if (at === null || !shown) return;
    refocus.current = null;
    const cards = grid.current?.querySelectorAll('[data-testid="library-card"]') ?? [];
    const card = cards[Math.min(at, cards.length - 1)];
    (card?.querySelector<HTMLElement>('button[aria-label^="Delete "]') ?? search.current)?.focus();
  }, [shown]);

  async function open(s: StoredScan) {
    // The saved thumbnail stands in for the screenshot so vision models can still look.
    openScan(s, 'saved', await thumbDataUrl(s.id).catch(() => null));
    setTab('inspect');
  }

  /** Make this scan the target, then jump to Generate's "Check your build" card. */
  async function checkBuild(s: StoredScan) {
    openScan(s, 'saved', await thumbDataUrl(s.id).catch(() => null));
    setTab('generate');
    requestCheck();
  }

  async function rescan(s: StoredScan) {
    setError(null);
    setBusy(`Re-scanning ${s.host}…`);
    try {
      await ensureSiteAccess();
      const out = await rescanUrl(s.url);
      openScan(out.scan, 'tab', out.screenshot);
      setTab('inspect');
    } catch (e) {
      setError(friendlyScanError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }

  function exportScans(list: StoredScan[]) {
    downloadText(exportFilename(), buildExport(list));
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const r = await importFile(file);
      const parts = [
        `Imported ${r.imported}`,
        r.duplicates > 0 && `${r.duplicates} already in your Library`,
        r.skipped > 0 && `skipped ${r.skipped}`,
      ].filter(Boolean);
      toast(parts.join(', '));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  }

  async function cleanUp() {
    if (!scans) return;
    exportScans(scans);
    const extra = scans.length - LIBRARY_SOFT_CAP;
    if (
      extra > 0 &&
      window.confirm(
        `Your export was downloaded. Delete the ${extra} oldest scans from this browser now?`,
      )
    ) {
      await deleteScans(scans.slice(LIBRARY_SOFT_CAP).map((s) => s.id));
      await reload();
    }
    dismissCap();
  }

  function dismissCap() {
    setOverCap(false);
    void chrome.storage.local.set({ [KEY_CAP_ASKED]: true }).catch(() => {});
  }

  if (scans === null) return <p className="py-10 text-center text-muted-foreground">Loading…</p>;

  if (mode === 'compose') {
    return (
      <Compose
        scans={scans}
        initialBase={scans.find((s) => s.id === current?.id)?.id}
        onExit={() => setMode('browse')}
        onSaved={() => {
          setMode('browse');
          void reload();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="library-view">
      {overCap && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-2 text-xs">
          <span>
            Your Library has more than {LIBRARY_SOFT_CAP} scans. Export a backup and clear out the
            oldest?
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void cleanUp()}>
              Export & clean up
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissCap}>
              Not now
            </Button>
          </div>
        </div>
      )}
      {scans.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Mascot size={48} />
          <p className="text-muted-foreground">Scans you make are saved here</p>
          <Button onClick={() => setTab('scan')}>Scan a page</Button>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => fileInput.current?.click()}
          >
            or import a .specimen.json file
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search host, title, tag"
                aria-label="Search the Library"
                className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <Button size="sm" onClick={() => setMode('compose')}>
              <Layers size={13} />
              Compose
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                exportScans(selected.size > 0 ? scans.filter((s) => selected.has(s.id)) : scans)
              }
            >
              <Download size={13} />
              Export{selected.size > 0 ? ` (${selected.size})` : ''}
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload size={13} />
              Import
            </Button>
          </div>
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="library-import"
        onChange={(e) => {
          void onImport(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {busy && (
        <div role="status" className="text-xs text-muted-foreground">
          {busy}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 p-2 text-xs text-destructive"
        >
          <Mascot size={32} mood="sad" />
          <span className="min-w-0">{error}</span>
        </div>
      )}
      {scans.length > 0 && shown.length === 0 && (
        <p className="py-6 text-center text-muted-foreground">No scans match "{query}".</p>
      )}
      <div ref={grid} className="grid grid-cols-2 gap-2">
        {shown.map((s, i) => (
          <ScanCard
            key={s.id}
            scan={s}
            thumb={thumbs.get(s.id)}
            selected={selected.has(s.id)}
            onSelect={() =>
              setSelected((sel) => {
                const next = new Set(sel);
                if (!next.delete(s.id)) next.add(s.id);
                return next;
              })
            }
            onOpen={() => open(s)}
            onRescan={() => void rescan(s)}
            onCheck={() => void checkBuild(s)}
            onChanged={() => void reload()}
            onDeleted={() => {
              refocus.current = i;
            }}
            onError={setError}
          />
        ))}
      </div>
    </div>
  );
}
