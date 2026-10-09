# Submit Specimen to the Chrome Web Store

A checklist for the maintainer.

## Before you start
- [ ] The release is tagged (`git tag v1.0.0 && git push origin v1.0.0`). The `Release` workflow builds the zip and attaches it to a GitHub Release. You can also run `pnpm zip` locally; the file lands in `apps/extension/.output/` (named like `specimenextension-1.0.0-chrome.zip`).
- [ ] You have the final screenshots and the 440x280 promo tile ([screenshots.md](screenshots.md)).

## Steps
1. Register as a Chrome Web Store developer at https://chrome.google.com/webstore/devconsole. Registration has a one-time fee (currently US$5). You must verify your account (a Google account with 2-step verification).
2. In the dashboard, click **New item** and upload the zip from the GitHub Release (or from `pnpm zip`).
3. **Store listing** tab: paste the fields from [listing.md](listing.md) (title, summary, description, category Developer Tools, language English). Upload the screenshots and the small promo tile. Add the marquee tile if you have one. Homepage URL: https://github.com/ayu-works/specimen. Support URL: https://github.com/ayu-works/specimen/issues.
4. **Privacy practices** tab: paste the single purpose, every permission justification and the remote-code answer from [privacy-practices.md](privacy-practices.md). Tick the data-usage boxes and the three certifications as listed there.
5. Privacy policy URL: use `https://<site>/privacy` once the website is live. Until then use the GitHub file: https://github.com/ayu-works/specimen/blob/main/PRIVACY.md (merge it to `main` first). Update the dashboard when the site is live.
6. **Distribution** tab: visibility Public, regions All regions, pricing Free.
7. Click **Submit for review**. Choose to publish automatically after approval, or to publish manually.
8. Review usually takes from a few days to about a week. A first submission, or one with optional host and `debugger` permissions, can take longer. Watch the email on your developer account for questions.
9. After approval, replace the placeholder `https://chromewebstore.google.com/detail/specimen/TODO` in `README.md` with the real listing URL.

## If review rejects it
Read the reason in the dashboard. The usual causes are an unclear permission justification (fix the text in `privacy-practices.md`), a missing privacy policy URL, or screenshots that show other brands. Fix and resubmit.
