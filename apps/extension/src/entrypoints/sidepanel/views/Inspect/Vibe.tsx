import { vibe } from '@specimen/ai';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/components/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { libraryErrorText, updateScan } from '@/lib/db';
import { useStore } from '../../store';

// Module state, not component state: Inspect unmounts on a tab switch while a run goes on.
/** The latest run; an older run's result never reaches the panel. */
let latestRun = 0;
/** The model call in flight; a remounted card shows it as busy instead of starting another. */
let running: Promise<void> | null = null;
/** Library writes in order, so an older run's save never lands after a newer one's. */
let saves: Promise<void> = Promise.resolve();
/** The latest run's error, so a card remounted after a tab switch still shows it. */
let lastErr: { scanId: string; text: string } | null = null;
/** Mounted cards; with none, an error is only seen as a toast. */
let mounted = 0;

/** Stall timeouts, as in the council: to the first text, then between pieces of text. */
export const VIBE_TIMEOUT_MS = 120_000;
export const VIBE_GAP_MS = 30_000;
export const VIBE_TIMEOUT_TEXT =
  'No answer from the model (it may be busy or still loading). Try again in a moment.';

/** "Describe the vibe": vision providers only; the result feeds the prompt's visual direction. */
export function VibeCard() {
  const { scan, screenshot, setVibe } = useStore();
  const ai = useAiContext();
  const [busy, setBusy] = useState(running !== null);
  const [err, setErr] = useState(lastErr);
  const [note, setNote] = useState('');
  const [saveErr, setSaveErr] = useState<{ scanId: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    mounted++;
    void running?.then(() => {
      if (!live) return;
      setBusy(false);
      setErr(lastErr);
    });
    return () => {
      live = false;
      mounted--;
    };
  }, []);
  if (!scan) return null;

  const provider = ai.provider;
  const enabled = !!provider && !busy;

  async function run() {
    if (!provider || !scan || running) return;
    const id = ++latestRun;
    const shown = () => latestRun === id && useStore.getState().scan?.id === scan.id;
    setBusy(true);
    lastErr = null;
    setErr(null);
    setNote('');
    setSaveErr(null);
    // A provider that never settles must not keep the card busy: give up when no text arrives for
    // a while, abort the call, and never read its result (a late reply is neither shown nor saved).
    const ctl = new AbortController();
    const timeout = new Error(VIBE_TIMEOUT_TEXT);
    let fail: (e: Error) => void = () => {};
    const stalled = new Promise<never>((_, reject) => {
      fail = reject;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const arm = (ms: number) => {
      if (settled) return; // a late reply's text never re-arms a finished run
      clearTimeout(timer);
      timer = setTimeout(() => {
        fail(timeout); // settles the race now; a provider's own abort error arrives later
        ctl.abort();
      }, ms);
    };
    // Slow but streaming text (a local model on a weak GPU) keeps the run alive.
    const watched: typeof provider = {
      ...provider,
      async *chat(req, signal) {
        arm(VIBE_TIMEOUT_MS); // each call (a retry too) is a fresh request with its own wait for text
        for await (const d of provider.chat(req, signal)) {
          arm(VIBE_GAP_MS);
          yield d;
        }
      },
    };
    arm(VIBE_TIMEOUT_MS);
    const call = Promise.race([vibe(watched, scan, screenshot, ctl.signal), stalled]);
    let finish: () => void = () => {};
    running = new Promise<void>((r) => {
      finish = r;
    });
    let v: Awaited<typeof call>;
    try {
      v = await call;
    } catch (e) {
      const error = {
        scanId: scan.id,
        text: e instanceof Error ? e.message : 'Could not describe the vibe.',
      };
      if (latestRun === id) lastErr = error;
      if (shown()) setErr(error);
      // Nobody may be looking (a tab switch during the wait): then the toast says it.
      if (e === timeout && (mounted === 0 || !shown())) toast(error.text);
      return;
    } finally {
      settled = true;
      clearTimeout(timer);
      running = null;
      finish(); // after lastErr is set, so a remounted card reads it
      setBusy(false);
    }
    const next = { summary: v.summary, keywords: v.keywords, model: v.model };
    // A vibe for a scan the panel has moved off is never shown on the new one, but is still saved.
    if (shown()) {
      setVibe(next);
      if (!v.usedImage) setNote('Based on the measured values (this model can’t look at images).');
    }
    // Persist for saved scans, by id; a scan not in the Library simply has no row to update.
    const save = saves.then(() => updateScan(scan.id, { vibe: next }));
    saves = save.catch(() => {});
    try {
      await save;
    } catch (e) {
      // The vibe stays usable in this panel, but it must not look saved. The toast outlives this
      // card (a tab switch) and covers a scan no longer shown; the line stays while it is.
      const text = `Vibe not saved to Library: ${libraryErrorText(e)}`;
      toast(text);
      if (shown()) setSaveErr({ scanId: scan.id, text });
    }
  }

  const hint = provider ? '' : `${SETUP_HINT} to describe the vibe`;

  return (
    <Card className="flex flex-col gap-2" data-testid="vibe-card">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="mb-0">Vibe</CardTitle>
        <Button size="sm" variant="outline" onClick={run} disabled={!enabled}>
          <Sparkles size={13} />
          {busy ? 'Looking…' : 'Describe the vibe'}
        </Button>
      </div>
      {hint && (
        <button
          type="button"
          onClick={openSettings}
          className="self-start text-left text-[11px] text-muted-foreground underline"
        >
          {hint}
        </button>
      )}
      {err?.scanId === scan.id && <p className="text-xs text-destructive">{err.text}</p>}
      {saveErr?.scanId === scan.id && (
        <p role="alert" className="text-xs text-destructive">
          {saveErr.text}
        </p>
      )}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      {scan.vibe && (
        <div className="flex flex-col gap-1.5">
          <p>{scan.vibe.summary}</p>
          <div className="flex flex-wrap gap-1">
            {scan.vibe.keywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
