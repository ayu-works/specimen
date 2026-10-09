# Privacy practices tab

Answers for the Chrome Web Store dashboard. Everything here matches the code and [PRIVACY.md](../PRIVACY.md).

## Single purpose
Specimen measures the design system of a web page (colors, type, spacing, shapes, layout) and exports it as a prompt or a DESIGN.md file for AI coding agents and developers.

## Permission justifications

**activeTab**
Lets Specimen read the tab the user is acting on when they click the toolbar icon or use a keyboard shortcut, so it can measure that page. It is used only on user action.

**scripting**
Injects Specimen's bundled sampler (to measure computed styles) and its overlays (grid, inspector, eyedropper) into the page the user chose to scan. Nothing is injected in the background or on page load.

**sidePanel**
The whole interface (Scan, Inspect, Generate, Ask, Library) lives in Chrome's side panel.

**storage**
Saves settings (AI provider choice, output options) and the user's optional API key in `chrome.storage.local`. Uses `chrome.storage.session` for the keyboard shortcut hand-off. Keys are never put in sync storage.

**offscreen**
Creates one hidden document, with the reason WORKERS, that runs the optional local Gemma model in a Web Worker. Service workers cannot start the WebGPU worker themselves. It is created only when the user uses local Gemma.

**unlimitedStorage**
The local Library (scans, thumbnails, chats) is kept in IndexedDB, and optional local model weights (0.7 to 5.2 GB) are kept in Cache Storage. Both exceed the default quota.

**debugger (optional)**
Requested at runtime only when the user clicks a capture that needs it: emulating a phone-width viewport or the dark color scheme to measure the mobile layout or dark theme. It is attached to the scanned tab for a few seconds and then detached. It is not granted at install.

**Host permission `<all_urls>` (optional)**
Requested once, on the user's first scan. Opening the side panel from the toolbar does not grant activeTab, and Specimen needs to read the page being scanned, take a thumbnail, and fetch that page's own stylesheets so the measurements are complete. The user can revoke it at any time. There are no host permissions at install and no content scripts declared in the manifest.

## Remote code
**Are you using remote code?** No.

All JavaScript and WebAssembly is bundled in the extension package. The local-model runtime (the WebLLM model-library `.wasm` files) is shipped in the package under `models/`. At runtime only model weights are downloaded, from Hugging Face, and only when the user opts in to local Gemma. Weights are data and are not executed as code.

## Data usage

Check these boxes for **what user data is collected**:
- **Website content**: Yes, handled as follows. A page the user scans is processed locally to compute measurements. Measured values are stored on the device. Page content is transmitted off the device only if the user configures their own AI provider and uses an AI feature, and then only a compact summary of measured values (and, for the Vibe feature with a vision-capable model, a screenshot) goes to the provider the user chose.
- **Authentication information**: Yes, only if the user adds an API key. It is stored in `chrome.storage.local` on the device and sent only to the provider it belongs to, as authentication.
- Personally identifiable information, health information, financial and payment information, personal communications, location, web history, user activity (clicks, keystrokes, and so on): **No**.

Specimen does not collect data for the developer. The developer receives nothing. The boxes above describe data that is handled on the device or sent to a provider the user selected.

## Certifications (check all three)
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL
Use the hosted policy (see `store/SUBMIT.md`).
