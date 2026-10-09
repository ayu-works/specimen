# Security policy

## Supported versions
| Version | Supported |
|---|---|
| 1.x | Yes |
| Older | No |

## Reporting a vulnerability
Please do not open a public issue. Use GitHub private vulnerability reporting:
https://github.com/ayu-works/specimen/security/advisories/new

Include the steps to reproduce, the Chrome version and the extension version. Do not include real API keys. You will get a reply as soon as the maintainer can. Fixes ship in a patch release, and you will be credited if you want.

## In scope
- **API key handling.** Keys leaking through logs, errors, storage other than `chrome.storage.local`, sync, or requests to anything but the chosen provider.
- **Page data leaving the device.** Any path that sends scan data or page content anywhere other than the AI provider the user configured, or without a user action.
- **Permission escalation.** Gaining host or API access beyond what the manifest and the user's prompts grant, or a web page reaching extension APIs.
- **Prompt injection from page text.** Page content that makes an AI feature act outside its role (for example exfiltrate data, change measured values or inject brand text into generated output).

## Out of scope
- Problems that need a malicious extension or a compromised browser profile.
- Findings in the AI providers themselves.
- Missing hardening that has no demonstrated impact.
