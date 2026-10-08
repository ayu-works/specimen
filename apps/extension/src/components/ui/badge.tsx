import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Badge({ className, ...p }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground',
        className,
      )}
      {...p}
    />
  );
}
