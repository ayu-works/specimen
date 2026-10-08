import { ask } from '@specimen/ai';
import { Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { loadChat, saveChat } from '@/lib/db';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const STARTERS = [
  'What makes this design feel the way it does?',
  'Which colors should I use for errors and success states?',
  'How would I adapt this for a mobile app?',
];

/** Streams keep running if the tab is switched; the store holds the text. One at a time. */
let controller: AbortController | null = null;

export function Ask() {
  const { scan, chats, setChat, setTab } = useStore();
  const ai = useAiContext();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = scan ? (chats[scan.id] ?? []) : [];

  const scanKey = scan?.id;
  // Load the saved transcript of this scan once (a live in-memory chat always wins).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the scan id only
  useEffect(() => {
    if (!scanKey || useStore.getState().chats[scanKey]) return;
    let live = true;
    void loadChat(scanKey).then((saved) => {
      if (live && saved.length > 0) setChat(scanKey, (prev) => (prev.length > 0 ? prev : saved));
    });
    return () => {
      live = false;
    };
  }, [scanKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the transcript grows
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  if (!scan) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-muted-foreground">Scan a page first, then ask questions about it.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }
  if (!ai.provider) {
    const waiting = ai.state === 'locked' || ai.state === 'loading';
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center" data-testid="ask-setup">
        <p className="text-muted-foreground">
          {ai.state === 'locked'
            ? 'Unlock your API key above to ask questions.'
            : ai.state === 'loading'
              ? 'The local model is still loading…'
              : `${SETUP_HINT} to ask questions about this design.`}
        </p>
        {!waiting && <Button onClick={openSettings}>Open Settings</Button>}
      </Card>
    );
  }
  const provider = ai.provider;
  const scanId = scan.id;

  async function submit(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    setBusy(true);
    const history = (chats[scanId] ?? [])
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setChat(scanId, (p) => [
      ...p,
      { role: 'user', content: question },
      { role: 'assistant', content: '' },
    ]);
    const setLast = (patch: { content?: string; error?: string }) =>
      setChat(scanId, (p) => p.map((m, i) => (i === p.length - 1 ? { ...m, ...patch } : m)));
    controller = new AbortController();
    try {
      if (!scan) return;
      const final = await ask(provider, scan, question, history, {
        signal: controller.signal,
        onText: (t) => setLast({ content: t }),
      });
      setLast({ content: final });
    } catch (e) {
      const kind = (e as { kind?: string } | null)?.kind;
      if (kind !== 'aborted') {
        setLast({ error: e instanceof Error ? e.message : 'Something went wrong.' });
      }
    } finally {
      controller = null;
      setBusy(false);
      void saveChat(scanId, useStore.getState().chats[scanId] ?? []);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ask-view">
      {messages.length === 0 && (
        <Card className="flex flex-col gap-2">
          <p className="text-muted-foreground">Ask about the measured design:</p>
          {STARTERS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void submit(q)}
              className="rounded-md border border-border px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {q}
            </button>
          ))}
        </Card>
      )}
      <div className="flex flex-col gap-2" aria-live="polite">
        {messages.map((m, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
            key={i}
            data-testid={`ask-${m.role}`}
            className={cn(
              'max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-3 py-2',
              m.role === 'user'
                ? 'self-end bg-primary text-primary-foreground'
                : 'self-start bg-muted',
            )}
          >
            {m.error ? <span className="text-destructive">{m.error}</span> : m.content || '…'}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this design…"
          aria-label="Question"
          disabled={busy}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => controller?.abort()}
            aria-label="Stop"
          >
            <Square size={14} />
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim()} aria-label="Send">
            <Send size={14} />
          </Button>
        )}
      </form>
      <p className="text-[11px] text-muted-foreground">
        Answers use only the measured values and are sent to {provider.label}.
      </p>
    </div>
  );
}
