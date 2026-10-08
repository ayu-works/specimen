# Prompt template spec

`generatePrompt(scan, { target })` returns Markdown of about 800-1500 tokens (3,200-6,000 chars).
It is a pure function of the scan: same input, byte-identical output.

## Sections (fixed order)
1. **Goal**: build a new, original UI; match the look through exact values; copy no brand, logo, name or text.
2. **Visual direction**: 2-3 deterministic sentences (light/dark, density, accent hue + vivid/muted, display face + weight, corner style). The AI `vibe.summary` is appended when present.
3. **Color tokens**: role / hex / usage table (fixed usage note per role) + up to 6 supporting colors.
4. **Typography**: families with brand-free fallback stacks (free alternative suggested for proprietary fonts), then a role / size / weight / line-height / letter-spacing table.
5. **Spacing & shape**: base unit, scale, section padding, content gap, radii, shadow levels, border widths.
6. **Layout blueprint**: container, gutter, breakpoints, numbered generic section list. Never any page text.
7. **Component rules**: primary/secondary button, card, input, link, derived from the tokens.
8. **Do / Don't**: about 6 bullets.
9. **Build instructions**: per target.

## Targets
| Target | Section 9 |
|---|---|
| `generic` | Stack-agnostic; CSS custom properties on `:root`. |
| `claude-code` | Next.js (App Router) + Tailwind v4, tokens in `@theme`, components in `components/`; compare against the values before finishing. |
| `cursor` | Numbered step list for the composer. |
| `v0` | shadcn/ui components themed with the tokens. |
| `lovable` | React + Tailwind, single-page landing. |

## Ethics guardrail
The final `sanitize()` pass removes the host, title, headline samples and brand tokens (host SLD and
uncommon title words) case-insensitively. Font families whose name contains the brand are described
as "the source's custom <role> face" with a free alternative. In dev/test it throws if the host survives.
