import { useEffect, useState } from 'react';
import { Mascot } from '@/components/Mascot';
import { Toaster } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiProvider, openSettings, useAiContext } from '@/lib/aiContext';
import { unlockKeys } from '@/lib/aiSettings';
import { scrubStoredChats } from '@/lib/chatScrub';
import { initCouncil, moodFor, useCouncil } from '@/lib/council';
import { useFlag } from '@/lib/flags';
import { cn } from '@/lib/utils';
import { sampleScan } from './dev/sampleScan';
import { rememberPanel, restorePanel } from './restore';
import { type TabId, useStore } from './store';
import { useShortcut } from './useShortcut';
import { Ask } from './views/Ask';
import { Council } from './views/Council';
import { Generate } from './views/Generate';
import { Inspect } from './views/Inspect';
import { Library } from './views/Library';
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
      // The key is readable now: let the one-time scrub finish its exact-key pass (no-op once done).
      void scrubStoredChats();
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
  const { activeTab, setTab, scan, succeed, status } = useStore();
  const flag = useFlag('critique');
  const council = flag === true;
  const { record, seen } = useCouncil();
  useShortcut();

  // The council runs in the offscreen document; the service worker stops it when the flag, the
  // provider or a key changes. The panel only reads the newest run and reattaches to it.
  useEffect(() => {
    if (council) void initCouncil();
  }, [council]);
  const mood = council
    ? moodFor(record, seen, status === 'scanning')
    : status === 'scanning'
      ? 'scanning'
      : 'idle';
  const openCouncil = () => {
    useStore.getState().setAskMode('council');
    setTab('ask');
  };

  useEffect(() => {
    if (new URLSearchParams(location.search).get('demo') === '1') {
      succeed(sampleScan, null, null);
      const t = new URLSearchParams(location.search).get('tab');
      if (t) setTab(t as TabId);
      return;
    }
    // Reopen where the user left off (SPC-26), then keep remembering it for this window.
    let stop: (() => void) | undefined;
    let live = true;
    void restorePanel().then((windowId) => {
      if (live && windowId !== undefined) stop = rememberPanel(windowId);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [succeed, setTab]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[420px] flex-col text-[13px]">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {council && (mood === 'thinking' || mood === 'happy' || mood === 'sad') ? (
            <button
              type="button"
              onClick={openCouncil}
              data-testid="mascot-council"
              aria-label={
                mood === 'thinking'
                  ? 'The council is thinking. Open it'
                  : 'The council has finished. Open the verdict'
              }
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mascot size={32} mood={mood} bounce={mood === 'thinking'} />
            </button>
          ) : (
            <Mascot size={32} mood={mood} />
          )}
          <h1 className="text-base font-semibold tracking-tight">Specimen</h1>
        </div>
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
            <AskPane council={council} />
          </TabsContent>
          <TabsContent value="library">
            <Library />
          </TabsContent>
        </main>
      </Tabs>
      <Toaster />
    </div>
  );
}

/** Ask has two modes with the Labs flag on: a quick answer, or the council. */
function AskPane({ council }: { council: boolean }) {
  const { askMode, setAskMode } = useStore();
  if (!council) return <Ask />;
  const modes = [
    { id: 'quick', label: 'Quick answer' },
    { id: 'council', label: 'Ask the council' },
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Ask mode"
        className="flex self-start rounded-md border border-border p-0.5 text-xs"
      >
        {modes.map((m) => (
          // biome-ignore lint/a11y/useSemanticElements: a two-option segmented switch
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={askMode === m.id}
            onClick={() => setAskMode(m.id)}
            className={cn(
              'rounded px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              askMode === m.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {askMode === 'council' ? <Council /> : <Ask />}
    </div>
  );
}
