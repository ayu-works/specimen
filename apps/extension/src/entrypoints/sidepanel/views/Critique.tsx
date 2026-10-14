import {
  CRITIQUE_LIMITS,
  type CritiqueTurn,
  critiquePlan,
  type KeepChange,
  PERSONAS,
  type PersonaId,
} from '@specimen/ai';
import { Copy, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Mascot } from '@/components/Mascot';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { cn } from '@/lib/utils';
import { useStore } from '../store';
import { useCritique } from './critiqueStore';

const DOT: Record<PersonaId, string> = {
  brand: 'bg-pink-500',
  a11y: 'bg-emerald-500',
  frontend: 'bg-sky-500',
  skeptic: 'bg-amber-500',
};

function speaker(t: CritiqueTurn): string {
  if (t.kind === 'human') return 'You';
  if (t.kind === 'summary') return 'Summary';
  return t.persona ? PERSONAS[t.persona].name : 'Reviewer';
}

function TurnBody({ t }: { t: CritiqueTurn }) {
  if (t.status === 'error') return <span className="text-destructive">{t.error}</span>;
  if (t.status === 'waiting' || t.status === 'retrying') {
    return (
      <span className="text-muted-foreground" data-testid="critique-wait">
        {t.status === 'waiting'
          ? 'Pacing for the rate limit, next turn in '
          : 'Rate limited by the provider, waiting '}
        <Countdown at={t.retryAt ?? Date.now() + (t.retryInMs ?? 0)} />…
      </span>
    );
  }
  if (t.status === 'empty') {
    return (
      <span className="text-muted-foreground">
        The model returned no text for this turn. If this keeps happening, pick another model in
        Settings.
      </span>
    );
  }
  if (t.status === 'filtered') {
    return (
      <span className="text-muted-foreground">This turn was removed by the brand filter.</span>
    );
  }
  if (!t.content) {
    if (t.status === 'streaming') {
      return (
        <span className="flex items-center gap-2">
          <Mascot size={32} mood="thinking" bounce />…
        </span>
      );
    }
    return <span className="text-muted-foreground">(no reply)</span>;
  }
  return (
    <>
      {t.content}
      {t.status === 'stopped' && <span className="text-muted-foreground"> (stopped)</span>}
    </>
  );
}

/** Seconds left until `at`, ticking. */
function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.ceil((at - now) / 1000))}s</>;
}

function asText(s: KeepChange): string {
  return [
    'Keep:',
    ...s.keep.map((k) => `- ${k}`),
    '',
    'Change:',
    ...s.change.map((c) => `- ${c}`),
  ].join('\n');
}

function Summary({ summary }: { summary: KeepChange }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(summary));
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
  }
  return (
    <div className="flex flex-col gap-2" data-testid="critique-summary">
      {(['keep', 'change'] as const).map((k) => (
        <Card key={k} className="flex flex-col gap-1.5">
          <CardTitle className="mb-0">{k === 'keep' ? 'Keep' : 'Change'}</CardTitle>
          <ul className="m-0 list-disc pl-4">
            {summary[k].map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <li key={i}>{item}</li>
            ))}
          </ul>
        </Card>
      ))}
      <Button variant="outline" size="sm" onClick={() => void copy()} className="self-start">
        <Copy size={14} />
        Copy list
      </Button>
    </div>
  );
}

/** Experimental (flag `flags.critique`): AI reviewers discuss the scan; the user can steer. */
export function Critique() {
  const { scan, setTab } = useStore();
  const ai = useAiContext();
  const c = useCritique();
  const [input, setInput] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the transcript grows
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [c.turns, c.queued]);

  if (!scan) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Mascot size={48} />
        <p className="text-muted-foreground">Scan a page first, then start a critique panel.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }
  if (!ai.provider) {
    const waiting = ai.state === 'locked' || ai.state === 'loading';
    return (
      <Card
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="critique-setup"
      >
        <Mascot size={48} />
        <p className="text-muted-foreground">
          {ai.state === 'locked'
            ? 'Unlock your API key above to start a critique panel.'
            : ai.state === 'loading'
              ? 'The local model is still loading…'
              : `${SETUP_HINT} to start a critique panel.`}
        </p>
        {!waiting && <Button onClick={openSettings}>Open Settings</Button>}
      </Card>
    );
  }
  const provider = ai.provider;
  const plan = critiquePlan(provider, scan, { personas: c.personas, rounds: c.rounds });
  const running = c.phase === 'running';
  const modelTurns = c.turns.filter((t) => t.kind !== 'human');
  const current = Math.max(1, modelTurns.length);
  const summarizing = running && modelTurns[modelTurns.length - 1]?.kind === 'summary';
  const k = (n: number) => Math.max(1, Math.round(n / 1000));
  const cost = `${plan.totalTurns} calls · ~${k(plan.estTokens)}k–${k(plan.maxTokens)}k tokens to ${provider.label}`;
  const pace = plan.estMinutes
    ? `Paced under ${k(plan.tokensPerMinute ?? 0)}k tokens/min (free-tier limit), so a run takes about ${plan.estMinutes} min.`
    : null;
  const runLabel = c.runProvider?.label ?? provider.label;
  const ownTranscript = c.scanId === scan.id;

  function toggle(p: PersonaId) {
    const on = c.personas.includes(p);
    if (on && c.personas.length <= CRITIQUE_LIMITS.minPersonas) return;
    if (!on && c.personas.length >= CRITIQUE_LIMITS.maxPersonas) return;
    c.setPersonas(on ? c.personas.filter((x) => x !== p) : [...c.personas, p]);
  }

  if (c.phase === 'setup' || !ownTranscript) {
    return (
      <div className="flex flex-col gap-3" data-testid="critique-view">
        <Card className="flex flex-col gap-3">
          <CardTitle className="mb-0">Critique panel (experimental)</CardTitle>
          <p className="text-muted-foreground">
            AI reviewers discuss the measured design in turns. You can steer them while they talk.
            It ends with a keep / change list.
          </p>
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-xs text-muted-foreground">
              Reviewers ({CRITIQUE_LIMITS.minPersonas}–{CRITIQUE_LIMITS.maxPersonas})
            </legend>
            {(Object.keys(PERSONAS) as PersonaId[]).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.personas.includes(p)}
                  onChange={() => toggle(p)}
                />
                <span className={cn('size-2 rounded-full', DOT[p])} />
                {PERSONAS[p].name}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2">
            Rounds
            <select
              value={c.rounds}
              onChange={(e) => c.setRounds(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2"
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground" data-testid="critique-cap">
            {cost}
          </p>
          {pace && <p className="text-xs text-muted-foreground">{pace}</p>}
          <Button onClick={() => void c.start(provider, scan)}>Start panel</Button>
        </Card>
        <p className="text-[11px] text-muted-foreground">
          Each turn sends the measured values (no page text) to {provider.label}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="critique-view">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span data-testid="critique-progress">
          {running ? `Turn ${current} of ${plan.totalTurns}` : `${plan.totalTurns} turns max`}
          {' · '}
          {runLabel}
        </span>
        {!running && (
          <Button variant="outline" size="sm" onClick={() => c.reset(scan.id)}>
            Start over
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2" aria-live="polite">
        {c.turns.map((t, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
            key={i}
            data-testid={`critique-${t.kind}`}
            className={cn(
              'max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-3 py-2',
              t.kind === 'human'
                ? 'self-end bg-primary text-primary-foreground'
                : 'self-start bg-muted',
            )}
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium opacity-80">
              {t.persona && <span className={cn('size-2 rounded-full', DOT[t.persona])} />}
              {speaker(t)}
            </div>
            <TurnBody t={t} />
          </div>
        ))}
        {c.queued.map((q, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: queue order
            key={`q${i}`}
            data-testid="critique-queued"
            className="max-w-[92%] self-end whitespace-pre-wrap break-words rounded-lg border border-dashed border-border px-3 py-2"
          >
            {q}
            <div className="text-[11px] text-muted-foreground">
              {running ? 'Queued for the next reviewer' : 'Not sent'}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {c.phase === 'done' && c.summary && <Summary summary={c.summary} />}
      {c.phase === 'done' && !c.summary && (
        <p className="text-xs text-muted-foreground">
          {c.turns[c.turns.length - 1]?.content
            ? "The summary wasn't a clean keep / change list; it's shown above as written."
            : 'No summary was produced.'}
        </p>
      )}
      {c.phase === 'error' && (
        <p className="flex items-center gap-2 text-destructive" data-testid="critique-error">
          <Mascot size={32} mood="sad" />
          {c.error}
        </p>
      )}
      {running && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            c.send(input);
            setInput('');
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={summarizing ? 'Writing the summary…' : 'Steer the panel…'}
            aria-label="Message to the panel"
            disabled={summarizing}
            maxLength={1000}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={summarizing || !input.trim()} aria-label="Send">
            <Send size={14} />
          </Button>
          <Button type="button" variant="outline" onClick={c.stop} aria-label="Stop">
            <Square size={14} />
            Stop
          </Button>
        </form>
      )}
    </div>
  );
}
