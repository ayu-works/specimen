import { createContext, type ReactNode, useContext } from 'react';
import { cn } from '@/lib/utils';

const Ctx = createContext<{ value: string; set: (v: string) => void }>({
  value: '',
  set: () => {},
});

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Ctx.Provider value={{ value, set: onValueChange }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-0.5 border-b border-border px-2', className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const c = useContext(Ctx);
  const active = c.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => c.set(value)}
      className={cn(
        '-mb-px border-b-2 px-2.5 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const c = useContext(Ctx);
  if (c.value !== value) return null;
  return <div role="tabpanel">{children}</div>;
}
