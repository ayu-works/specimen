import { useEffect } from 'react';
import { Toaster } from '@/components/toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { sampleScan } from './dev/sampleScan';
import { type TabId, useStore } from './store';
import { Inspect } from './views/Inspect';
import { Scan } from './views/Scan';

const TABS: { id: TabId; label: string }[] = [
  { id: 'scan', label: 'Scan' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'generate', label: 'Generate' },
  { id: 'ask', label: 'Ask' },
  { id: 'library', label: 'Library' },
];

export default function App() {
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
        <span className="truncate pl-3 text-xs text-muted-foreground">
          {scan?.host ?? 'no scan yet'}
        </span>
      </header>
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
          {(['generate', 'ask', 'library'] as const).map((id) => (
            <TabsContent key={id} value={id}>
              <p className="py-10 text-center text-muted-foreground">Coming soon</p>
            </TabsContent>
          ))}
        </main>
      </Tabs>
      <Toaster />
    </div>
  );
}
