import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type DesignScan,
  diffScans,
  GENERATORS,
  type GeneratorId,
  generateDesignMd,
  generateFixPrompt,
  generatePrompt,
  PROMPT_TARGETS,
  type PromptTarget,
} from '@specimen/core';
import { z } from 'zod';
import { type Bridge, NOT_CONNECTED } from './bridge';
import { getEntry, listEntries, type StoredEntry } from './store';

export const SERVER_VERSION = '0.0.0';

const TOKEN_FORMATS = GENERATORS.map((g) => g.id).filter(
  (id) => id !== 'prompt' && id !== 'designmd',
) as [GeneratorId, ...GeneratorId[]];

const ROLES = ['background', 'surface', 'textPrimary', 'accent', 'border'] as const;

function roleColors(scan: DesignScan): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of ROLES) {
    const id = scan.colors.roles[role];
    const hex = id ? scan.colors.palette.find((t) => t.id === id)?.hex : undefined;
    if (hex) out[role] = hex;
  }
  return out;
}

function summary({ scan, tags }: StoredEntry) {
  return {
    id: scan.id,
    title: scan.title,
    host: scan.host,
    url: scan.url,
    scannedAt: new Date(scan.scannedAt).toISOString(),
    tags,
    colors: roleColors(scan),
  };
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ isError: true, content: [{ type: 'text' as const, text: t }] });
const notFound = (id: string) =>
  fail(`No scan with id "${id}". Call list_scans to see the available ids.`);

/** Remove the other-theme variants so the prompt/tokens describe the scanned scheme only. */
function withoutThemes(scan: DesignScan): DesignScan {
  if (!scan.variants) return scan;
  const { dark: _d, light: _l, ...rest } = scan.variants;
  return { ...scan, variants: Object.keys(rest).length > 0 ? rest : undefined };
}

export function createServer(bridge: Bridge): McpServer {
  const server = new McpServer(
    { name: 'specimen', version: SERVER_VERSION },
    {
      instructions:
        'Specimen exposes design systems measured from real websites (colors, type, spacing, shapes, layout). Call list_scans first, then get_prompt or get_tokens for the scan you want to build from. Never copy brand names, logos or copy from a source site.',
    },
  );

  server.registerTool(
    'list_scans',
    {
      title: 'List design scans',
      description:
        'List the website design scans saved in the user’s Specimen library, newest first. Returns id, title, host, scan time, tags and the five main role colors (background, surface, textPrimary, accent, border). Use the id with the other tools. Optional `query` filters by title, host, url or tag.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Case-insensitive text to match in title, host, URL or tags'),
      },
    },
    ({ query }) => {
      const q = query?.trim().toLowerCase();
      const rows = listEntries().filter(
        (e) =>
          !q ||
          [e.scan.title, e.scan.host, e.scan.url, ...e.tags].some((s) =>
            s.toLowerCase().includes(q),
          ),
      );
      if (rows.length === 0) {
        return text(
          'No scans yet. In Chrome, open Specimen, scan a site, and make sure "Share scans with coding agents" is on (Specimen settings).',
        );
      }
      return text(JSON.stringify(rows.map(summary), null, 2));
    },
  );

  server.registerTool(
    'get_scan',
    {
      title: 'Get a design scan',
      description:
        'Return the full DesignScan JSON for one scan: palette with roles, typography, spacing, radii, shadows, layout, components and variants. Large; prefer get_prompt or get_tokens unless you need raw values.',
      inputSchema: { id: z.string().describe('Scan id from list_scans') },
    },
    ({ id }) => {
      const e = getEntry(id);
      return e ? text(JSON.stringify(e.scan, null, 2)) : notFound(id);
    },
  );

  server.registerTool(
    'get_prompt',
    {
      title: 'Get the agent prompt',
      description:
        'Generate the agent-ready design prompt (colors, type, spacing, shapes, layout, component rules) for a scan, tuned for a target tool. It deliberately contains no brand names, logos or copy; use it to build something original in the same visual style.',
      inputSchema: {
        id: z.string().describe('Scan id from list_scans'),
        target: z
          .enum([...PROMPT_TARGETS] as [PromptTarget, ...PromptTarget[]])
          .optional()
          .describe('Tool the prompt is for (default generic)'),
        includeTheme: z
          .boolean()
          .optional()
          .describe(
            'Include the dark/light counterpart theme tokens when the scan has them (default true)',
          ),
      },
    },
    ({ id, target, includeTheme }) => {
      const e = getEntry(id);
      if (!e) return notFound(id);
      const scan = includeTheme === false ? withoutThemes(e.scan) : e.scan;
      return text(generatePrompt(scan, { target }).content);
    },
  );

  server.registerTool(
    'get_design_md',
    {
      title: 'Get DESIGN.md',
      description:
        'Generate a DESIGN.md document (human- and agent-readable design system spec) for a scan.',
      inputSchema: { id: z.string().describe('Scan id from list_scans') },
    },
    ({ id }) => {
      const e = getEntry(id);
      return e ? text(generateDesignMd(e.scan).content) : notFound(id);
    },
  );

  server.registerTool(
    'get_tokens',
    {
      title: 'Get design tokens',
      description:
        'Generate design tokens for a scan in the requested format: tailwind-v4 (CSS @theme), tailwind-v3 (config), cssvars, shadcn (theme CSS), dtcg (W3C design tokens JSON) or figma (variables JSON).',
      inputSchema: {
        id: z.string().describe('Scan id from list_scans'),
        format: z.enum(TOKEN_FORMATS).describe('Output format'),
      },
    },
    ({ id, format }) => {
      const e = getEntry(id);
      if (!e) return notFound(id);
      const gen = GENERATORS.find((g) => g.id === format);
      return gen ? text(gen.run(e.scan).content) : fail(`Unknown format "${format}".`);
    },
  );

  server.registerTool(
    'check_build',
    {
      title: 'Check a build against a scan',
      description:
        'Scan a running page (for example http://localhost:3000) in the user’s Chrome through the Specimen extension, compare it with a saved target scan, and return the fidelity score plus a fix prompt listing the biggest differences. Use it after building to self-check, then apply the fixes. Only local development URLs are allowed (localhost, 127.0.0.1, *.localhost, *.test). Requires Chrome open with Specimen paired; takes up to 60 s.',
      inputSchema: {
        targetId: z.string().describe('Scan id of the design you are matching (from list_scans)'),
        url: z.string().url().describe('URL of your build, e.g. http://localhost:3000'),
      },
    },
    async ({ targetId, url }) => {
      const target = getEntry(targetId);
      if (!target) return notFound(targetId);
      if (!/^https?:\/\//i.test(url)) return fail('Only http(s) URLs can be checked.');
      if (!bridge.connected) return fail(NOT_CONNECTED);
      try {
        const build = await bridge.requestScan(url);
        const report = diffScans(target.scan, build);
        const fix = generateFixPrompt(report, target.scan).content;
        const facets = Object.entries(report.facets)
          .map(([k, v]) => `${k}: ${Math.round((v as { score: number }).score)}`)
          .join(' · ');
        return text(`Fidelity score: ${report.score}/100 (${facets})\n\n${fix}`);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  const idList = () => ({
    resources: listEntries().map((e) => ({
      uri: `specimen://scans/${e.scan.id}`,
      name: `${e.scan.host}: ${e.scan.title}`,
      mimeType: 'application/json',
    })),
  });

  server.registerResource(
    'scan',
    new ResourceTemplate('specimen://scans/{id}', { list: idList }),
    {
      title: 'Design scan',
      description: 'The full DesignScan JSON.',
      mimeType: 'application/json',
    },
    (uri, { id }) => {
      const e = getEntry(String(id));
      if (!e) throw new Error(`No scan with id "${String(id)}".`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(e.scan, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'scan-prompt',
    new ResourceTemplate('specimen://scans/{id}/prompt', {
      list: () => ({
        resources: listEntries().map((e) => ({
          uri: `specimen://scans/${e.scan.id}/prompt`,
          name: `${e.scan.host}: prompt`,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Agent prompt',
      description: 'The generated design prompt.',
      mimeType: 'text/markdown',
    },
    (uri, { id }) => {
      const e = getEntry(String(id));
      if (!e) throw new Error(`No scan with id "${String(id)}".`);
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: generatePrompt(e.scan).content },
        ],
      };
    },
  );

  return server;
}
