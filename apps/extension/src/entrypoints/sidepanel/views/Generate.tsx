import { polishPrompt } from '@specimen/ai';
import {
  GENERATORS,
  type GeneratedFile,
  type GeneratorId,
  PROMPT_TARGETS,
  type PromptTarget,
  TARGET_LABELS,
} from '@specimen/core';
import { Code2, Copy, Download, Heart, Sparkles, Square } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { type SimpleIcon, siClaude, siCursor, siV0 } from 'simple-icons';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { openSettings, useAiContext } from '@/lib/aiContext';
import { SETUP_HINT } from '@/lib/aiRuntime';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const KEY_FORMAT = 'settings.lastFormat';
const KEY_TARGET = 'settings.promptTarget';
const DEFAULT_FORMAT = 'prompt';
const DEFAULT_TARGET: PromptTarget = 'claude-code';

/** The panel offers two outputs; token exports stay in core for the MCP bridge and power users. */
const FORMATS = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'designmd', label: 'DESIGN.md' },
] as const satisfies readonly { id: GeneratorId; label: string }[];
type FormatId = (typeof FORMATS)[number]['id'];

/** Target order in the logo row; `generic` last as the catch-all. */
const TARGET_ORDER: PromptTarget[] = ['claude-code', 'cursor', 'v0', 'lovable', 'generic'];

async function loadSettings(): Promise<{ format?: FormatId; target?: PromptTarget }> {
  try {
    const got = await chrome.storage.local.get([KEY_FORMAT, KEY_TARGET]);
    const format = FORMATS.find((f) => f.id === got[KEY_FORMAT])?.id;
    const target = PROMPT_TARGETS.find((t) => t === got[KEY_TARGET]);
    return { format, target };
  } catch {
    return {};
  }
}

async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true">
      <path d={icon.path} />
    </svg>
  );
}

/** Lovable has no Simple Icons entry, so it gets a heart; generic gets a code glyph. */
const TARGET_ICONS: Record<PromptTarget, () => ReactElement> = {
  'claude-code': () => <BrandIcon icon={siClaude} />,
  cursor: () => <BrandIcon icon={siCursor} />,
  v0: () => <BrandIcon icon={siV0} />,
  lovable: () => <Heart size={18} aria-hidden="true" />,
  generic: () => <Code2 size={18} aria-hidden="true" />,
};

function Segmented({ value, onChange }: { value: FormatId; onChange: (id: FormatId) => void }) {
  return (
    <fieldset
      aria-label="Output"
      className="m-0 min-w-0 border-0 p-0 grid grid-cols-2 rounded-lg bg-muted p-1"
    >
      {FORMATS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={f.id === value}
          onClick={() => onChange(f.id)}
          className={cn(
            'rounded-md py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            f.id === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {f.label}
        </button>
      ))}
    </fieldset>
  );
}

function TargetLogos({
  value,
  onChange,
}: {
  value: PromptTarget;
  onChange: (t: PromptTarget) => void;
}) {
  return (
    <fieldset
      aria-label="Prompt for"
      className="m-0 min-w-0 border-0 p-0 flex justify-between gap-1.5"
    >
      {TARGET_ORDER.map((t) => {
        const Icon = TARGET_ICONS[t];
        return (
          <button
            key={t}
            type="button"
            aria-pressed={t === value}
            aria-label={TARGET_LABELS[t]}
            title={TARGET_LABELS[t]}
            onClick={() => onChange(t)}
            className={cn(
              'flex h-10 flex-1 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              t === value
                ? 'border-foreground bg-muted text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon />
          </button>
        );
      })}
    </fieldset>
  );
}

/** Lightweight line tint: markdown headings/tables/bullets, CSS custom properties, comments. */
function lineClass(line: string, filename: string): string {
  if (/\.md$/.test(filename)) {
    if (/^#{1,6}\s/.test(line)) return 'font-semibold text-foreground';
    if (line.startsWith('|')) return 'text-muted-foreground';
    if (/^\s*(?:[-*]|\d+\.)\s/.test(line)) return 'text-foreground/90';
    return '';
  }
  if (/^\s*(?:\/\*|\/\/|\*)/.test(line)) return 'italic text-muted-foreground';
  if (/^\s*--[\w-]+\s*:/.test(line)) return 'text-foreground';
  if (/^\s*(?:@|:root|\[data-theme|module\.exports)/.test(line))
    return 'font-semibold text-primary';
  return '';
}

function Preview({ file }: { file: GeneratedFile }) {
  const lines = file.content.split('\n');
  return (
    <pre
      data-testid="generate-preview"
      className="max-h-[52vh] min-h-40 overflow-auto rounded-md border border-border bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed"
    >
      {lines
        .map((line, i) => ({ id: `${i}`, line }))
        .map(({ id, line }) => (
          <span
            key={id}
            className={cn('block whitespace-pre-wrap break-words', lineClass(line, file.filename))}
          >
            {line || ' '}
          </span>
        ))}
    </pre>
  );
}

export function Generate() {
  const { scan, setTab } = useStore();
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [target, setTarget] = useState<PromptTarget>(DEFAULT_TARGET);
  const ai = useAiContext();
  // An AI-polished prompt replaces the deterministic one until the scan, target or vibe changes.
  const [polished, setPolished] = useState<{ key: string; text: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const polishCtl = useRef<AbortController | null>(null);
  const polishKey = `${scan?.id}|${target}|${scan?.vibe?.summary ?? ''}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the inputs change
  useEffect(() => {
    polishCtl.current?.abort();
    setPolished(null);
    setNotice(null);
  }, [polishKey, format]);

  useEffect(() => {
    let live = true;
    void loadSettings().then((s) => {
      if (!live) return;
      if (s.format) setFormat(s.format);
      if (s.target) setTarget(s.target);
    });
    return () => {
      live = false;
    };
  }, []);

  const result = useMemo(() => {
    if (!scan) return null;
    const gen = GENERATORS.find((g) => g.id === format) ?? GENERATORS[0];
    if (!gen) return null;
    try {
      return { file: gen.run(scan, { target }), error: null };
    } catch (e) {
      return { file: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [scan, format, target]);

  if (!scan) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-muted-foreground">Scan a page first to generate a prompt or tokens.</p>
        <Button onClick={() => setTab('scan')}>Go to Scan</Button>
      </div>
    );
  }

  const base = result?.file ?? null;
  const override = format === 'prompt' && polished?.key === polishKey ? polished.text : null;
  const file = base && override !== null ? { ...base, content: override } : base;
  const approxTokens = file ? Math.round(file.content.length / 4) : 0;

  function pickFormat(id: FormatId) {
    setFormat(id);
    void saveSetting(KEY_FORMAT, id);
  }
  function pickTarget(t: PromptTarget) {
    setTarget(t);
    void saveSetting(KEY_TARGET, t);
  }

  async function polish() {
    const provider = ai.provider;
    if (!scan || !base || !provider || polishing) return;
    const key = polishKey;
    setPolishing(true);
    setNotice(null);
    const ctl = new AbortController();
    polishCtl.current = ctl;
    try {
      const res = await polishPrompt(provider, scan, base.content, {
        signal: ctl.signal,
        onText: (text) => setPolished({ key, text }),
      });
      if (res.polished) setPolished({ key, text: res.text });
      else {
        setPolished(null);
        const why = res.reason ?? 'the AI output was unusable';
        setNotice(`Kept the original: ${why.charAt(0).toLowerCase()}${why.slice(1)}`);
      }
    } catch (e) {
      setPolished(null);
      if ((e as { kind?: string } | null)?.kind !== 'aborted') {
        setNotice(`Kept the original: ${e instanceof Error ? e.message : 'polish failed'}`);
      }
    } finally {
      setPolishing(false);
    }
  }

  async function copy() {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      toast('Copied');
    } catch {
      toast('Copy failed');
    }
  }

  function download() {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2.5">
        <Segmented value={format} onChange={pickFormat} />
        {format === 'prompt' && <TargetLogos value={target} onChange={pickTarget} />}
      </Card>

      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="mb-0">
            {format === 'prompt' ? `Prompt · ${TARGET_LABELS[target]}` : 'DESIGN.md'}
          </CardTitle>
          {file && (
            <span
              className="font-mono text-[10px] text-muted-foreground"
              data-testid="generate-stats"
            >
              {file.content.length.toLocaleString()} chars · ~{approxTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        {format === 'prompt' &&
          (ai.provider ? (
            <div className="flex items-center gap-2">
              {polishing ? (
                <Button size="sm" variant="outline" onClick={() => polishCtl.current?.abort()}>
                  <Square size={12} />
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={polish} disabled={!base}>
                  <Sparkles size={13} />
                  Polish with AI
                </Button>
              )}
              {override !== null && !polishing && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline"
                  onClick={() => setPolished(null)}
                >
                  Use original
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={openSettings}
              className="self-start text-left text-[11px] text-muted-foreground underline"
            >
              ✨ Polish with AI · {SETUP_HINT}
            </button>
          ))}
        {notice && (
          <p
            role="status"
            className="text-[11px] text-muted-foreground"
            data-testid="polish-notice"
          >
            {notice}
          </p>
        )}
        {result?.error && (
          <p role="alert" className="rounded-md border border-destructive/40 p-2 text-destructive">
            Could not generate this format: {result.error}
          </p>
        )}
        {file && <Preview file={file} />}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={copy} disabled={!file}>
            <Copy size={14} />
            Copy
          </Button>
          <Button variant="outline" className="flex-1" onClick={download} disabled={!file}>
            <Download size={14} />
            Download
          </Button>
        </div>
        {file && <p className="text-[11px] text-muted-foreground">Saves as {file.filename}</p>}
      </Card>
    </div>
  );
}
