import { useEffect, useState } from 'react';
import { Toaster } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiProvider, openSettings, useAiContext } from '@/lib/aiContext';
import { unlockKeys } from '@/lib/aiSettings';
import { cn } from '@/lib/utils';
import { sampleScan } from './dev/sampleScan';
import { type TabId, useStore } from './store';
import { Ask } from './views/Ask';
import { Generate } from './views/Generate';
import { Inspect } from './views/Inspect';
import { Scan } from './views/Scan';

const TABS: { id: TabId; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'generate', label: 'Generate' },
  { id: 'ask', label: 'Ask' },
  { id: 'library', label: 'Library' },
];

/** Header chip showing the active provider; opens the options page. */
function AiChip() {
  const ai = useAiContext();
  return (
    <button
      type="button"
      onClick={openSettings}
      title={ai.detail ?? 'Open AI settings'}
      data-testid="ai-chip"
      className={cn(
        'shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        ai.state === 'ready' ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {ai.label}
    </button>
  );
}

/** Asked once per browser session when keys are passphrase-encrypted. */
function UnlockBanner() {
  const ai = useAiContext();
  const [pass, setPass] = useState('');
  const [bad, setBad] = useState(false);
  if (ai.state !== 'locked' || !ai.lockedPreset) return null;
  const preset = ai.lockedPreset;
  async function unlock() {
    const ok = await unlockKeys(preset, pass);
    setBad(!ok);
    if (ok) {
      setPass('');
      ai.refresh();
    }
  }
  return (
    <form
      className="flex flex-col gap-1.5 border-b border-border bg-muted/50 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void unlock();
      }}
    >
      <label htmlFor="unlock-pass" className="text-xs text-muted-foreground">
        Enter your passphrase to unlock your API key for this session.
      </label>
      <div className="flex gap-2">
        <input
          id="unlock-pass"
          type="password"
          autoComplete="off"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
        />
        <Button size="sm" type="submit" disabled={!pass}>
          Unlock
        </Button>
      </div>
      {bad && <p className="text-xs text-destructive">Wrong passphrase.</p>}
    </form>
  );
}

export default function App() {
  return (
    <AiProvider>
      <Panel />
    </AiProvider>
  );
}

function Panel() {
  const { activeTab, setTab, scan, succeed } = useStore();

  useEffect(() => {
    if (new URLSearchParams(location.search).get('demo') === '1') {
      succeed(sampleScan, null, null);
      const t = new URLSearchParams(location.search).get('tab');
      if (t) setTab(t as TabId);
    }
  }, [succeed, setTab]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[420px] flex-col text-[13px]">
      <header className="flex items-baseline justify-between border-b border-border px-3 py-2.5">
        <h1 className="text-base font-semibold tracking-tight">Specimen</h1>
        <div className="flex min-w-0 items-center gap-2 pl-3">
          <span className="truncate text-xs text-muted-foreground">
            {scan?.host ?? 'no scan yet'}
          </span>
          <AiChip />
        </div>
      </header>
      <UnlockBanner />
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <main className="p-3">
          <TabsContent value="scan">
            <Scan />
          </TabsContent>
          <TabsContent value="inspect">
            <Inspect />
          </TabsContent>
          <TabsContent value="generate">
            <Generate />
          </TabsContent>
          <TabsContent value="ask">
            <Ask />
          </TabsContent>
          <TabsContent value="library">
            <p className="py-10 text-center text-muted-foreground">Coming soon</p>
          </TabsContent>
        </main>
      </Tabs>
      <Toaster />
    </div>
  );
}
