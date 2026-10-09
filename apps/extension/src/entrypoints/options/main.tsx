import { isChromeBuiltinAvailable } from '@specimen/ai';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { Mascot } from '@/components/Mascot';
import { Card, CardTitle } from '@/components/ui/card';
import {
  type AiProviderId,
  type AiSettings,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSettings,
  watchAi,
} from '@/lib/aiSettings';
import { cn } from '@/lib/utils';
import { Byok } from './Byok';
import { LocalGemma } from './LocalGemma';

const CHOICES: { id: AiProviderId; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'AI features are off. Everything else works as usual.' },
  {
    id: 'webllm',
    label: 'Local Gemma',
    hint: 'Runs in your browser on your GPU. Private and offline.',
  },
  { id: 'chrome', label: 'Chrome built-in', hint: 'Uses the model built into Chrome.' },
  { id: 'byok', label: 'API key', hint: 'Use your own key with Claude, OpenAI, Gemini and more.' },
];

function Options() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [chrome_, setChrome] = useState(false);

  useEffect(() => {
    void loadAiSettings().then(setSettings);
    void isChromeBuiltinAvailable().then(setChrome);
    return watchAi(() => void loadAiSettings().then(setSettings));
  }, []);

  const choices = CHOICES.filter((c) => c.id !== 'chrome' || chrome_);
  const current = CHOICES.find((c) => c.id === settings.provider);

  async function pick(id: AiProviderId) {
    setSettings(await saveAiSettings({ provider: id }));
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8 text-[13px]">
      <div className="flex items-center gap-3">
        <Mascot size={48} />
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>
      <Card className="flex flex-col gap-3">
        <CardTitle className="mb-0">AI provider</CardTitle>
        <p className="text-muted-foreground">
          AI is optional. Specimen measures everything without it; AI only adds Ask, Polish and
          Vibe. Page data goes only to the provider you choose here.
        </p>
        <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-1.5 border-0 p-0 sm:grid-cols-4">
          <legend className="sr-only">AI provider</legend>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={settings.provider === c.id}
              onClick={() => void pick(c.id)}
              className={cn(
                'rounded-md border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                settings.provider === c.id
                  ? 'border-foreground bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </fieldset>
        {current && <p className="text-xs text-muted-foreground">{current.hint}</p>}
      </Card>
      {settings.provider === 'webllm' && <LocalGemma settings={settings} onChange={setSettings} />}
      {settings.provider === 'byok' && <Byok settings={settings} onChange={setSettings} />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
