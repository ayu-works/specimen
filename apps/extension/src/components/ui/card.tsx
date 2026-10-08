import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...p }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-lg border border-border bg-background p-3', className)} {...p} />
  );
}

export function CardTitle({ className, ...p }: React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...p}
    />
  );
}
