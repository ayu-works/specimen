# Chrome Web Store listing

Paste these into the Developer Dashboard, Store listing tab. Plain text only; the store does not render Markdown.

## Name
Specimen

## Title suggestion
The extension name is taken from the manifest (`Specimen`). "Code Specimen" is an unrelated extension, so if the dashboard lets you set a longer display title, use:

Specimen – Design system to AI prompt

(37 characters.)

## Summary (max 132 characters)
Measure a site’s colors, type, spacing and layout, then export an AI-ready prompt and DESIGN.md. No account, no tracking.

Count: 121 characters.

(The manifest `description` is separate: "Measure any website’s design system and turn it into an agent-ready prompt and DESIGN.md." It is 89 characters.)

## Detailed description
Specimen measures the design system of any website and turns it into something an AI coding agent can use.

Open the side panel, click Scan, and Specimen reads the page's computed styles in your browser. It finds the colors and their roles (background, text, accent, borders), the type scale and font families, the spacing scale, corner radii, shadows and the page layout.

What you can do with it
• Inspect the palette, type scale, spacing, shapes, components and layout, with a contrast check against WCAG AA.
• Turn on a baseline grid, a live element inspector or an eyedropper on the page.
• Generate a prompt for Claude Code, Cursor, v0, Lovable or any agent, or a DESIGN.md file. Copy it or download it.
• Capture the mobile layout and the dark or light theme, and merge several pages of one site into a single scan.
• Check a page you built against the original and get a prompt that fixes the differences.
• Save every scan to a local Library. Search, tag, export and import. Compose a new design by mixing the colors of one scan with the type or spacing of another.

Optional AI
Everything above works without AI. If you want it, you can ask questions about a design, polish the prompt and get a short description of the visual feel. Run it on a local Gemma model in your browser (a one-time download, then it works offline), use Chrome's built-in model where available, or bring your own API key for Claude, OpenAI, Gemini, Groq, OpenRouter, Ollama and others.

Privacy
• No account, no servers, no analytics, no tracking.
• Specimen reads a page only when you scan it. Chrome asks for site access once.
• Scans stay on your device.
• AI is off by default. If you add a provider, your scan summary goes only to that provider, when you use an AI feature. API keys stay in your browser's extension storage.

Built for inspiration, not copying
Prompts contain measured values only: colors, type, spacing and layout structure. They never include logos, brand names or page text, and they ask the agent to build something original.

Shortcuts: Alt+Shift+S opens the panel. Alt+Shift+C scans the current page and shows the prompt.

Specimen is free and open source (MIT): https://github.com/ayu-works/specimen

## Category
Developer Tools

## Language
English

## Other fields
- Homepage URL: https://github.com/ayu-works/specimen
- Support URL: https://github.com/ayu-works/specimen/issues
- Privacy policy URL: see `store/SUBMIT.md`.
