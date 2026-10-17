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

/** How long a vibe may take before the card gives up (the council's first-text stall). */
export const VIBE_TIMEOUT_MS = 120_000;
export const VIBE_TIMEOUT_TEXT = 'The model took too long to describe the vibe. Try again.';

/** "Describe the vibe": vision providers only; the result feeds the prompt's visual direction. */
export function VibeCard() {
  const { scan, screenshot, setVibe } = useStore();
  const ai = useAiContext();
  const [busy, setBusy] = useState(running !== null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [saveErr, setSaveErr] = useState<{ scanId: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    void running?.then(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
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
    setErr('');
    setNote('');
    setSaveErr(null);
    // A provider that never settles must not keep the card busy: give up after the timeout,
    // abort the call, and never read its result (a late reply is neither shown nor saved).
    const ctl = new AbortController();
    const timeout = new Error(VIBE_TIMEOUT_TEXT);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(timeout);
        ctl.abort();
      }, VIBE_TIMEOUT_MS);
    });
    const call = Promise.race([vibe(provider, scan, screenshot, ctl.signal), timedOut]);
    running = call.then(
      () => {},
      () => {},
    );
    let v: Awaited<typeof call>;
    try {
      v = await call;
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Could not describe the vibe.';
      // The card may have unmounted (a tab switch) while it waited; the toast outlives it.
      if (e === timeout) toast(text);
      if (shown()) setErr(text);
      return;
    } finally {
      clearTimeout(timer);
      running = null;
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
      {err && <p className="text-xs text-destructive">{err}</p>}
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
