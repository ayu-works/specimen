import { useState } from 'react';
import { Button } from '@/components/ui/button';

const TABS = ['Scan', 'Inspect', 'Generate', 'Ask', 'Library'] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Scan');
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border p-3">
        <h1 className="text-lg font-semibold">Specimen</h1>
      </header>
      <div className="flex gap-1 border-b border-border p-2" role="tablist">
        {TABS.map((t) => (
          <Button
            key={t}
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <main className="p-4 text-sm text-muted-foreground" role="tabpanel">
        {tab} (coming soon)
      </main>
    </div>
  );
}
