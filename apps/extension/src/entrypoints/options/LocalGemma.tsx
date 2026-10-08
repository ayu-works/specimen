import { WebLLMClient } from '@specimen/ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { type AiSettings, loadAiSettings, saveAiSettings } from '@/lib/aiSettings';
import { GEMMA_MODELS, gemmaById } from '@/lib/gemmaModels';
import { send } from '@/lib/messaging';
import { cn } from '@/lib/utils';

type Phase = 'checking' | 'none' | 'downloading' | 'ready' | 'error';

async function gpuStatus(): Promise<{ ok: boolean; text: string }> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return { ok: false, text: 'WebGPU is not available in this browser.' };
    if (!(await gpu.requestAdapter())) {
      return { ok: false, text: 'WebGPU is present but no GPU adapter was found.' };
    }
    return { ok: true, text: 'WebGPU is available.' };
  } catch {
    return { ok: false, text: 'WebGPU is not available in this browser.' };
  }
}

export function LocalGemma({
  settings,
  onChange,
}: {
  settings: AiSettings;
  onChange: (s: AiSettings) => void;
}) {
  const client = useMemo(
    () => new WebLLMClient(() => send('offscreen.ensure', {}).then(() => {})),
    [],
  );
  const model = gemmaById(settings.webllmModel) ?? GEMMA_MODELS[0];
  const [gpu, setGpu] = useState<{ ok: boolean; text: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');
  const modelId = model?.id ?? '';
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const markDownloaded = useCallback(
    async (id: string, yes: boolean) => {
      const cur = await loadAiSettings();
      const set = new Set(cur.downloaded);
      if (yes) set.add(id);
      else set.delete(id);
      onChange(await saveAiSettings({ downloaded: [...set] }));
    },
    [onChange],
  );

  const download = useCallback(async () => {
    if (!modelId) return;
    setError('');
    setPhase('downloading');
    try {
      await client.load(modelId, (p, text) => {
        if (!live.current) return;
        setProgress(p);
        setDetail(text);
      });
      await markDownloaded(modelId, true);
      if (live.current) setPhase('ready');
    } catch (e) {
      if (!live.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [client, modelId, markDownloaded]);

  // Learn the model's state; if a download is already running (started earlier), rejoin it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check only when the model changes
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    setError('');
    void gpuStatus().then((g) => !cancelled && setGpu(g));
    client.status(modelId).then(
      (st) => {
        if (cancelled) return;
        if (st.loading) {
          setProgress(st.p ?? 0);
          void download();
        } else if (st.loaded === modelId || st.cached) setPhase('ready');
        else setPhase('none');
      },
      (e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelId, client]);

  async function remove() {
    if (!modelId) return;
    setError('');
    try {
      await client.remove(modelId);
      await markDownloaded(modelId, false);
      setPhase('none');
      setProgress(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pct = Math.round(progress * 100);
  const busy = phase === 'downloading';

  return (
    <Card className="flex flex-col gap-3" data-testid="local-gemma">
      <CardTitle className="mb-0">Local Gemma (in your browser)</CardTitle>
      <p className="text-muted-foreground">
        One-time download of about {model?.downloadGB} GB. It runs offline on your GPU and nothing
        leaves your computer. Keep the download going in the background: you can close this page.
      </p>
      <p
        className={cn('text-xs', gpu && !gpu.ok ? 'text-destructive' : 'text-muted-foreground')}
        data-testid="webgpu-status"
      >
        {gpu ? gpu.text : 'Checking WebGPU…'}
      </p>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={busy}>
        <legend className="mb-1 text-xs font-medium">Model</legend>
        {GEMMA_MODELS.map((m) => (
          <label
            key={m.id}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md border p-2.5',
              m.id === modelId ? 'border-foreground bg-muted' : 'border-border',
            )}
          >
            <input
              type="radio"
              name="gemma"
              className="mt-0.5"
              checked={m.id === modelId}
              onChange={async () => onChange(await saveAiSettings({ webllmModel: m.id }))}
            />
            <span className="flex flex-col">
              <span className="font-medium">{m.label}</span>
              <span className="text-xs text-muted-foreground">
                ~{m.downloadGB} GB download · needs about {(m.vramMB / 1024).toFixed(1)} GB of GPU
                memory
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {busy && (
        <div className="flex flex-col gap-1">
          <div
            className="h-2 overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="truncate text-xs text-muted-foreground">{detail || 'Starting…'}</span>
        </div>
      )}
      <p className="text-sm" data-testid="gemma-status">
        {phase === 'checking' && 'Checking…'}
        {phase === 'none' && 'Not downloaded'}
        {phase === 'downloading' && `Downloading ${pct}%`}
        {phase === 'ready' && 'Ready'}
        {phase === 'error' && 'Something went wrong'}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={download} disabled={busy || phase === 'checking' || gpu?.ok === false}>
          {phase === 'ready' ? 'Load now' : 'Download & load'}
        </Button>
        <Button variant="outline" onClick={remove} disabled={busy || phase === 'none'}>
          Delete downloaded model
        </Button>
      </div>
    </Card>
  );
}
