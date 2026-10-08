import { mobileLines } from '@specimen/core';
import type { DesignScan } from '@specimen/core/schema';
import {
  AlignHorizontalDistributeCenter,
  BarChart3,
  Grid2x2,
  HelpCircle,
  LayoutTemplate,
  type LucideIcon,
  Megaphone,
  Menu,
  MessageSquareQuote,
  PanelBottom,
  Rows3,
  Tag,
  Type,
} from 'lucide-react';
import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  nav: Menu,
  hero: LayoutTemplate,
  logos: AlignHorizontalDistributeCenter,
  features: Grid2x2,
  stats: BarChart3,
  testimonials: MessageSquareQuote,
  pricing: Tag,
  cta: Megaphone,
  faq: HelpCircle,
  content: Type,
  footer: PanelBottom,
  unknown: Rows3,
};

export function Blueprint({ scan }: { scan: DesignScan }) {
  const mobileSections = scan.variants?.mobile?.blueprint;
  const [view, setView] = useState<'desktop' | 'mobile'>('desktop');
  const showMobile = view === 'mobile' && !!mobileSections;
  const sections = showMobile && mobileSections ? mobileSections : scan.layout.blueprint;
  const total = sections.reduce((a, s) => a + s.height, 0) || 1;
  const notes = showMobile ? mobileLines(scan) : [];
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <CardTitle className="mb-0">Blueprint</CardTitle>
        {mobileSections && (
          <fieldset
            aria-label="Blueprint view"
            className="m-0 flex min-w-0 gap-0.5 rounded-md border-0 bg-muted p-0.5"
          >
            {(['desktop', 'mobile'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                  view === v ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {v}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      {notes.length > 0 && (
        <ul className="mb-2 list-disc pl-4 text-[11px] text-muted-foreground">
          {notes.map((n) => (
            <li key={n}>{n.replace(/^- /, '')}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <ol className="flex min-w-0 flex-1 flex-col gap-1">
          {sections.map((s) => {
            const Icon = ICONS[s.kind] ?? Rows3;
            return (
              <li
                key={s.index}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1"
              >
                <Icon size={14} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{s.kind}</span>
                <span className="text-[11px] text-muted-foreground">
                  {s.arrangement}
                  {s.columns > 1 ? ` ×${s.columns}` : ''} · {Math.round(s.confidence * 100)}%
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex h-72 w-10 shrink-0 flex-col gap-px overflow-hidden rounded border border-border bg-border">
          {sections.map((s) => (
            <div
              key={s.index}
              title={s.kind}
              className="bg-muted hover:bg-primary/40"
              style={{ flexGrow: s.height / total, flexBasis: 0, minHeight: 2 }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}
