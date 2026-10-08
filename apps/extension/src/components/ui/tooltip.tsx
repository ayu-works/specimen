import type { ReactNode } from 'react';

/** Lightweight tooltip: native title attribute (no portal, works in the side panel). */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} className="inline-flex">
      {children}
    </span>
  );
}
