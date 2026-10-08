import type { FidelityDelta, FidelityReport } from '../diff';
import type { DesignScan } from '../schema';
import type { GeneratedFile } from './common';
import { sanitize } from './sanitize';

const MAX_ITEMS = 12;

/** One concrete, imperative line per delta. */
function fixLine(d: FidelityDelta): string {
  if (d.fix) return d.fix;
  if (d.actual === 'missing' || d.actual === 'not found') {
    return `${d.item}: add it, using ${d.expected}.`;
  }
  return `${d.item}: change ${d.actual} to ${d.expected}.`;
}

/**
 * Follow-up prompt for the coding agent after a Fidelity check. Lists the biggest differences,
 * most important first, as expected-vs-actual changes. Sanitised like the main prompt, so it
 * never carries the source's name or copy.
 */
export function generateFixPrompt(report: FidelityReport, source: DesignScan): GeneratedFile {
  const top = report.deltas.slice(0, MAX_ITEMS);
  const lines =
    top.length > 0
      ? top.map((d, i) => `${i + 1}. ${fixLine(d)}`)
      : ['1. No significant differences were found.'];
  const body = [
    `Your build scores ${report.score}/100 against the target design. Fix these, most important first:`,
    '',
    ...lines,
    '',
    "Don't change anything else.",
  ].join('\n');
  return {
    filename: 'specimen-fix-prompt.md',
    mime: 'text/markdown',
    content: `${sanitize(body, source)}\n`,
  };
}
