import {
  CRITIQUE_LIMITS,
  type CritiqueTurn,
  critiquePlan,
  MAX_CONTEXT,
  PERSONAS,
  type PersonaId,
  type Verdict,
} from '@specimen/ai';
import { Copy, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Mascot } from '@/components/Mascot';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { resolveProviderSpec, SETUP_HINT } from '@/lib/aiRuntime';
import { markSeen, startCouncil, stopCouncil, useCouncil } from '@/lib/council';
import type { CouncilRecord } from '@/lib/councilProtocol';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const DOT: Record<PersonaId, string> = {
  brand: 'bg-pink-500',
  a11y: 'bg-emerald-500',
  frontend: 'bg-sky-500',
  skeptic: 'bg-amber-500',
};

const ENDED_TEXT: Record<'stopped' | 'interrupted', string> = {
  stopped: 'You stopped the council.',
  interrupted:
    'The council was interrupted (the extension or the browser restarted). Start again to get a verdict.',
};

function speaker(t: CritiqueTurn): string {
  if (t.kind === 'human') return 'You';
  if (t.kind === 'summary') return 'Moderator';
  return t.persona ? PERSONAS[t.persona].name : 'Reviewer';
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

function TurnBody({ t }: { t: CritiqueTurn }) {
  if (t.status === 'error') return <span className="text-destructive">{t.error}</span>;
  if (t.status === 'waiting' || t.status === 'retrying') {
    return <span className="text-muted-foreground">Waiting for the rate limit…</span>;
  }
  if (t.status === 'empty')
    return <span className="text-muted-foreground">The model returned no text.</span>;
  if (t.status === 'filtered')
    return <span className="text-muted-foreground">Removed by the brand filter.</span>;
  if (!t.content) return <span className="text-muted-foreground">…</span>;
  return (
    <>
      {t.content}
      {t.status === 'stopped' && <span className="text-muted-foreground"> (stopped)</span>}
    </>
  );
}

/** The reviewers' turns, behind a small link that is closed by default. */
function Discussion({ turns }: { turns: CritiqueTurn[] }) {
  if (turns.length === 0) return null;
  return (
    <details className="text-xs" data-testid="council-discussion">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Show discussion
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {turns.map((t, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
            key={i}
            data-testid={`council-turn-${t.kind}`}
            className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2"
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium opacity-80">
              {t.persona && <span className={cn('size-2 rounded-full', DOT[t.persona])} />}
              {speaker(t)}
            </div>
            <TurnBody t={t} />
          </div>
        ))}
      </div>
    </details>
  );
}

function reportText(v: Verdict): string {
  const list = (title: string, items: string[]) =>
    items.length ? [title, ...items.map((x) => `- ${x}`), ''] : [];
  return [
    `Verdict: ${v.verdict}`,
    '',
    ...list('What works:', v.works),
    ...list('What to change:', v.change),
    ...list('Where the reviewers disagreed:', v.disagreed),
  ]
    .join('\n')
    .trim();
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-xs font-semibold">{title}</h3>
      <ul className="m-0 list-disc pl-4">
        {items.map((x, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Report({ rec }: { rec: CouncilRecord }) {
  const v = rec.verdict;
  async function copy() {
    if (!v) return;
    try {
      await navigator.clipboard.writeText(reportText(v));
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
  }
  if (!v) {
    return (
      <Card className="flex flex-col gap-2" data-testid="council-report">
        <CardTitle className="mb-0">Council verdict</CardTitle>
        {rec.summaryText ? (
          <p className="m-0 whitespace-pre-wrap">{rec.summaryText}</p>
        ) : (
          <p className="m-0 text-muted-foreground">
            No verdict was produced. Start again, or pick another model in Settings.
          </p>
        )}
      </Card>
    );
  }
  return (
    <Card className="flex flex-col gap-3" data-testid="council-report">
      <CardTitle className="mb-0">Council verdict</CardTitle>
      <p className="m-0 font-medium" data-testid="council-verdict">
        {v.verdict}
      </p>
      <Section title="What works" items={v.works} />
      <Section title="What to change" items={v.change} />
      <Section title="Where the reviewers disagreed" items={v.disagreed} />
      <Button variant="outline" size="sm" onClick={() => void copy()} className="self-start">
        <Copy size={14} />
        Copy report
      </Button>
    </Card>
  );
}

function when(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The council (flag `flags.critique`): runs in the background and ends with a verdict. */
export function Council() {
  const { scan, setTab } = useStore();
  const ai = useAiContext();
  const c = useCouncil();
  const [setup, setSetup] = useState(false);
  const rec = c.record;
  const finished = rec && rec.status !== 'running';

  // A new run replaces the old one: leave the setup card.
  const runId = rec?.runId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the run id only
  useEffect(() => setSetup(false), [runId]);

  // Showing a finished run counts as seen: the mascot calms down and the badge clears.
  useEffect(() => {
    if (rec && rec.status !== 'running' && !setup) markSeen(rec.runId);
  }, [rec, setup]);

  if (rec?.status === 'running') return <Running rec={rec} />;
  if (finished && !setup)
    return <Finished rec={rec} scanId={scan?.id ?? null} onAgain={() => setSetup(true)} />;

  if (!scan) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Mascot size={48} />
        <p className="text-muted-foreground">Scan a page first, then ask the council.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }
  if (!ai.provider) {
    const waiting = ai.state === 'locked' || ai.state === 'loading';
    return (
      <Card
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="council-setup-hint"
      >
        <Mascot size={48} />
        <p className="text-muted-foreground">
          {ai.state === 'locked'
            ? 'Unlock your API key above to ask the council.'
            : ai.state === 'loading'
              ? 'The local model is still loading…'
              : `${SETUP_HINT} to ask the council.`}
        </p>
        {!waiting && <Button onClick={openSettings}>Open Settings</Button>}
      </Card>
    );
  }
  const provider = ai.provider;
  const plan = critiquePlan(provider, scan, { personas: c.personas, rounds: c.rounds });
  const k = (n: number) => Math.max(1, Math.round(n / 1000));
  const cost = `${plan.totalTurns} calls · ~${k(plan.estTokens)}k–${k(plan.maxTokens)}k tokens to ${provider.label}`;
  const pace = plan.estMinutes
    ? `Paced under ${k(plan.tokensPerMinute ?? 0)}k tokens/min (free-tier limit): about ${plan.estMinutes} min.`
    : null;

  function toggle(p: PersonaId) {
    const on = c.personas.includes(p);
    if (on && c.personas.length <= CRITIQUE_LIMITS.minPersonas) return;
    if (!on && c.personas.length >= CRITIQUE_LIMITS.maxPersonas) return;
    c.setPersonas(on ? c.personas.filter((x) => x !== p) : [...c.personas, p]);
  }

  async function start() {
    if (!scan) return;
    const spec = await resolveProviderSpec().catch(() => null);
    if (!spec) {
      useCouncil.setState({ rejected: `${SETUP_HINT} to ask the council.` });
      return;
    }
    await startCouncil({ scan, provider: spec });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="council-setup">
      <Card className="flex flex-col gap-3">
        <CardTitle className="mb-0">Ask the council (experimental)</CardTitle>
        <p className="m-0 text-muted-foreground">
          AI reviewers discuss the measured design and agree on a verdict. You can close the panel:
          the mascot shows when the verdict is ready.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Your goal: what are you building, for whom, and what matters to you?
          </span>
          <textarea
            value={c.context}
            onChange={(e) => c.setContext(e.target.value)}
            maxLength={MAX_CONTEXT}
            rows={3}
            aria-label="Your goal"
            placeholder="e.g. A booking app for small clinics. Patients are older, so readability matters more than flair."
            className="min-h-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="self-end text-[11px] text-muted-foreground">
            {c.context.length}/{MAX_CONTEXT}
          </span>
        </label>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-xs text-muted-foreground">
            Reviewers ({CRITIQUE_LIMITS.minPersonas}–{CRITIQUE_LIMITS.maxPersonas})
          </legend>
          {(Object.keys(PERSONAS) as PersonaId[]).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input type="checkbox" checked={c.personas.includes(p)} onChange={() => toggle(p)} />
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
        <p className="m-0 text-xs text-muted-foreground" data-testid="council-cap">
          {cost}
        </p>
        {pace && <p className="m-0 text-xs text-muted-foreground">{pace}</p>}
        {c.rejected && (
          <p className="m-0 text-destructive" data-testid="council-rejected">
            {c.rejected}
          </p>
        )}
        <Button onClick={() => void start()} disabled={c.starting}>
          Ask the council
        </Button>
      </Card>
      <p className="text-[11px] text-muted-foreground" data-testid="council-privacy">
        Each turn sends the measured values (no page text) plus your goal text to {provider.label}.
        The run continues with the panel closed.
      </p>
    </div>
  );
}

function Running({ rec }: { rec: CouncilRecord }) {
  const models = rec.turns.filter((t) => t.kind !== 'human');
  const current = models[models.length - 1];
  const wait =
    current && (current.status === 'waiting' || current.status === 'retrying') ? current : null;
  return (
    <div className="flex flex-col gap-3" data-testid="council-running">
      <Card className="flex flex-col items-center gap-2 py-6 text-center">
        <Mascot size={48} mood="thinking" bounce />
        <p className="m-0 font-medium">The council is discussing…</p>
        <p className="m-0 text-xs text-muted-foreground" data-testid="council-progress">
          Turn {Math.max(1, models.length)} of {rec.plan.totalTurns} · {rec.plan.providerLabel}
        </p>
        {wait && (
          <p className="m-0 text-xs text-muted-foreground" data-testid="council-wait">
            {wait.status === 'waiting'
              ? 'Pacing for the rate limit, next turn in '
              : 'Rate limited by the provider, waiting '}
            <Countdown at={wait.retryAt ?? Date.now() + (wait.retryInMs ?? 0)} />…
          </p>
        )}
        <p className="m-0 text-[11px] text-muted-foreground">
          You can close the panel. The mascot shows when the verdict is ready.
        </p>
        <Button variant="outline" size="sm" onClick={stopCouncil}>
          <Square size={14} />
          Stop
        </Button>
      </Card>
      <Discussion turns={rec.turns} />
    </div>
  );
}

function Finished({
  rec,
  scanId,
  onAgain,
}: {
  rec: CouncilRecord;
  scanId: string | null;
  onAgain: () => void;
}) {
  const other = scanId !== null && rec.scanId !== scanId;
  return (
    <div className="flex flex-col gap-3" data-testid="council-finished">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span data-testid="council-header">
          {rec.scanHost} · {when(rec.updatedAt)} · {rec.plan.providerLabel}
        </span>
        <Button variant="outline" size="sm" onClick={onAgain}>
          {other ? 'Ask about the current scan' : 'Start again'}
        </Button>
      </div>
      {other && (
        <p className="m-0 text-xs text-muted-foreground" data-testid="council-other-scan">
          This verdict is for an earlier scan of {rec.scanHost}.
        </p>
      )}
      {rec.status === 'done' && <Report rec={rec} />}
      {rec.status === 'error' && (
        <p className="m-0 flex items-center gap-2 text-destructive" data-testid="council-error">
          <Mascot size={32} mood="sad" />
          {rec.error}
        </p>
      )}
      {(rec.status === 'stopped' || rec.status === 'interrupted') && (
        <p className="m-0 text-muted-foreground" data-testid={`council-${rec.status}`}>
          {ENDED_TEXT[rec.status]}
        </p>
      )}
      <Discussion turns={rec.turns} />
    </div>
  );
}
