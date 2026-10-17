import { vibe } from '@specimen/ai';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { libraryErrorText, updateScan } from '@/lib/db';
import { useStore } from '../../store';

/** "Describe the vibe": vision providers only; the result feeds the prompt's visual direction. */
export function VibeCard() {
  const { scan, screenshot, setVibe } = useStore();
  const ai = useAiContext();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [saveErr, setSaveErr] = useState<{ scanId: string; text: string } | null>(null);
  // The latest run: a result from an older run, or for a scan no longer shown, is dropped.
  const runId = useRef(0);
  if (!scan) return null;

  const provider = ai.provider;
  const enabled = !!provider && !busy;

  async function run() {
    if (!provider || !scan) return;
    const id = ++runId.current;
    const current = () => runId.current === id && useStore.getState().scan?.id === scan.id;
    setBusy(true);
    setErr('');
    setNote('');
    setSaveErr(null);
    try {
      const v = await vibe(provider, scan, screenshot);
      if (!current()) return;
      const next = { summary: v.summary, keywords: v.keywords, model: v.model };
      setVibe(next);
      if (!v.usedImage) setNote('Based on the measured values (this model can’t look at images).');
      try {
        // Persist for saved scans; a scan not in the Library simply has no row to update.
        await updateScan(scan.id, { vibe: next });
      } catch (e) {
        // The vibe stays usable in this panel, but it must not look saved.
        if (current())
          setSaveErr({ scanId: scan.id, text: `Vibe not saved to Library: ${libraryErrorText(e)}` });
      }
    } catch (e) {
      if (current()) setErr(e instanceof Error ? e.message : 'Could not describe the vibe.');
    } finally {
      if (runId.current === id) setBusy(false);
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
