import { vibe } from '@specimen/ai';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { useStore } from '../../store';

/** "Describe the vibe": vision providers only; the result feeds the prompt's visual direction. */
export function VibeCard() {
  const { scan, screenshot, setVibe } = useStore();
  const ai = useAiContext();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!scan) return null;

  const provider = ai.provider;
  const canSee = !!provider?.capabilities.vision;
  const hasShot = !!screenshot;
  const enabled = canSee && hasShot && !busy;

  async function run() {
    if (!provider || !scan || !screenshot) return;
    setBusy(true);
    setErr('');
    try {
      setVibe(await vibe(provider, scan, screenshot));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not describe the vibe.');
    } finally {
      setBusy(false);
    }
  }

  const hint = !provider
    ? `${SETUP_HINT} to describe the vibe`
    : !canSee
      ? 'This model cannot look at images. Pick a vision model in Settings.'
      : !hasShot
        ? 'No screenshot for this scan.'
        : '';

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
