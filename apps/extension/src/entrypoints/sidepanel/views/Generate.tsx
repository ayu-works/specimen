import {
  GENERATORS,
  type GeneratedFile,
  type GeneratorId,
  PROMPT_TARGETS,
  type PromptTarget,
  TARGET_LABELS,
} from '@specimen/core';
import { Copy, Download } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useStore } from '../store';

const KEY_FORMAT = 'settings.lastFormat';
const KEY_TARGET = 'settings.promptTarget';
const DEFAULT_FORMAT: GeneratorId = 'prompt';
const DEFAULT_TARGET: PromptTarget = 'claude-code';

async function loadSettings(): Promise<{ format?: GeneratorId; target?: PromptTarget }> {
  try {
    const got = await chrome.storage.local.get([KEY_FORMAT, KEY_TARGET]);
    const format = GENERATORS.find((g) => g.id === got[KEY_FORMAT])?.id;
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

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
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
  const [format, setFormat] = useState<GeneratorId>(DEFAULT_FORMAT);
  const [target, setTarget] = useState<PromptTarget>(DEFAULT_TARGET);

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

  const file = result?.file ?? null;
  const approxTokens = file ? Math.round(file.content.length / 4) : 0;

  function pickFormat(id: GeneratorId) {
    setFormat(id);
    void saveSetting(KEY_FORMAT, id);
  }
  function pickTarget(t: PromptTarget) {
    setTarget(t);
    void saveSetting(KEY_TARGET, t);
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
      <Card>
        <CardTitle>Format</CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {GENERATORS.map((g) => (
            <Pill key={g.id} active={g.id === format} onClick={() => pickFormat(g.id)}>
              {g.label}
            </Pill>
          ))}
        </div>
        {format === 'prompt' && (
          <>
            <CardTitle className="mt-3">Target</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_TARGETS.map((t) => (
                <Pill key={t} active={t === target} onClick={() => pickTarget(t)}>
                  {TARGET_LABELS[t]}
                </Pill>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="mb-0">Preview</CardTitle>
          {file && (
            <span
              className="font-mono text-[10px] text-muted-foreground"
              data-testid="generate-stats"
            >
              {file.content.length.toLocaleString()} chars · ~{approxTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
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
