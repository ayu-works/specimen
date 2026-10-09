# Privacy policy

Effective date: 2026-10-09

Specimen is an open-source Chrome extension. It has no backend, no account system, no analytics and no telemetry. The maintainers receive no data from it.

## What Specimen reads, and when
- **A page you scan.** When you click **Scan this page** (or use the `Alt+Shift+C` shortcut, a capture, **Add another page**, **Re-scan** or a fidelity check), Specimen reads that page's computed styles, CSS variables, fonts, layout and a screenshot thumbnail, and it fetches the page's stylesheets. It reads nothing in the background and does not read pages you have not asked it to scan. The scan stores measured values (colors, sizes, spacing and so on), not the page's text content. It also keeps the page's URL and title so you can find the scan later.
- **Site access.** On your first scan Chrome asks you to allow access to sites (an optional permission). You can revoke it at `chrome://extensions`.

## What is stored, and where
All of it stays on your device.
- **Library** (IndexedDB, database `specimen`): your scans, thumbnails, Ask chat history and composed designs.
- **Settings and keys** (`chrome.storage.local`): your AI provider choice, last-used output options and, if you add one, your API key. Keys are never put in `chrome.storage.sync`. You can encrypt keys with a passphrase; the passphrase is never stored, and a derived key is kept in session storage until the browser closes.
- **Model weights** (Cache Storage): only if you download local Gemma.
- **Session data** (`chrome.storage.session`): a short-lived marker for the keyboard shortcut. It is cleared when the browser closes.

## What is sent, and to whom
- **By default, nothing.** There is no Specimen server.
- **Your AI provider, only if you configure one and use an AI feature** (Ask, Polish, Vibe, Fetch models). Specimen then sends the request to the provider you chose (for example Anthropic, OpenAI, Google, Groq, OpenRouter, or a local server such as Ollama). The request contains a compact, truncated summary of your scan's measured values, your question, and for the Vibe feature with a vision-capable model, the page screenshot. It also sends your API key to that provider, as authentication. The provider's own privacy policy then applies. With local Gemma, Chrome's built-in model, or a localhost server, the data does not leave your device.
- **Hugging Face, only if you choose to download local Gemma.** Model weights are downloaded from `huggingface.co`. No scan data is sent. Hugging Face sees the download request as any website would (for example your IP address).
- **The pages you scan.** Specimen fetches stylesheets from the scanned site's own servers, the same requests your browser already makes, and your browser loads the site's favicon for the panel header.

Specimen does not sell or share data, and does not use data for ads or credit decisions.

## Remote code
Specimen loads no remote code. All scripts and the local-model runtime (`.wasm`) are bundled in the extension. Only model weights are downloaded, and they are data.

## Your control
- Delete a scan: Library, the card menu, **Delete**. Export your Library as JSON or import one any time.
- Remove an API key: Settings, **Remove key**.
- Delete local model weights: Settings, **Delete downloaded model**.
- Revoke site access, `debugger` or provider access: `chrome://extensions`, Specimen, Details, Site access.
- Remove everything: uninstall the extension. Chrome deletes its stored data.

## Changes
If this policy changes, the new version is committed to this repository (see the file history) and the effective date above is updated.

## Contact
Open an issue at https://github.com/ayu-works/specimen/issues. For security reports, see [SECURITY.md](SECURITY.md).
