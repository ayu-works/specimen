import { ask } from '@specimen/ai';
import { Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mascot } from '@/components/Mascot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { loadChat, saveChat } from '@/lib/db';
import { cn } from '@/lib/utils';
import { askHistory, STOPPED_TEXT } from '../askHistory';
import { useStore } from '../store';

const STARTERS = [
  'What makes this design feel the way it does?',
  'Which colors should I use for errors and success states?',
  'How would I adapt this for a mobile app?',
];

export const NO_ANSWER_TEXT = 'No answer came back. Try again.';
const INTERRUPTED_TEXT = 'The answer was interrupted. Try again.';

/**
 * Streams keep running if the tab is switched; the store holds the text. One at a time. What is in
 * flight lives here, not in component state, so a remounted Ask still shows Stop and blocks Send.
 */
let controller: AbortController | null = null;
let inFlight: { scanId: string; at: number } | null = null;
const listeners = new Set<() => void>();
function setInFlight(next: typeof inFlight): void {
  inFlight = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useInFlight = () => useSyncExternalStore(subscribe, () => inFlight);

export function Ask() {
  const { scan, chats, setChat, setTab } = useStore();
  const ai = useAiContext();
  const [input, setInput] = useState('');
  const running = useInFlight();
  const busy = running !== null;
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
        <Mascot size={48} />
        <p className="text-muted-foreground">Scan a page first, then ask questions about it.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }
  if (!ai.provider) {
    const waiting = ai.state === 'locked' || ai.state === 'loading';
    return (
      <Card className="flex flex-col items-center gap-3 py-8 text-center" data-testid="ask-setup">
        <Mascot size={48} />
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
    const history = askHistory(chats[scanId] ?? []);
    let at = -1;
    setChat(scanId, (p) => {
      at = p.length + 1;
      return [...p, { role: 'user', content: question }, { role: 'assistant', content: '' }];
    });
    // Patch this question's own answer, never "the last message" (a later one may follow it).
    const setLast = (patch: { content?: string; error?: string }) =>
      setChat(scanId, (p) => p.map((m, i) => (i === at ? { ...m, ...patch } : m)));
    const ctl = new AbortController();
    controller = ctl;
    setInFlight({ scanId, at });
    try {
      if (!scan) return;
      const final = await ask(provider, scan, question, history, {
        signal: ctl.signal,
        onText: (t) => setLast({ content: t }),
      });
      setLast(final ? { content: final } : { content: '', error: NO_ANSWER_TEXT });
    } catch (e) {
      // Stopped by the user, however the abort surfaced: marked, so it is never replayed as whole.
      const kind = (e as { kind?: string } | null)?.kind;
      setLast({
        error: ctl.signal.aborted
          ? STOPPED_TEXT
          : kind === 'aborted'
            ? INTERRUPTED_TEXT
            : e instanceof Error
              ? e.message
              : 'Something went wrong.',
      });
    } finally {
      if (controller === ctl) controller = null;
      setInFlight(null);
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
            {m.error ? (
              <>
                {/* Text that streamed before the error (e.g. an answer cut off at the length limit). */}
                {m.content && <span className="mb-2 block">{m.content}</span>}
                {m.error === STOPPED_TEXT ? (
                  <span className="text-muted-foreground text-xs">{m.error}</span>
                ) : (
                  <span className="flex items-center gap-2 text-destructive">
                    <Mascot size={32} mood="sad" />
                    {m.error}
                  </span>
                )}
              </>
            ) : m.content ? (
              m.content
            ) : running?.scanId === scan.id && running.at === i ? (
              <span className="flex items-center gap-2">
                <Mascot size={32} mood="thinking" bounce />…
              </span>
            ) : (
              // An empty answer saved before SPC-42 (or with no request running): never an endless "…".
              <span className="text-muted-foreground text-xs">No answer.</span>
            )}
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
