# Website

The Specimen landing page. Plain HTML with no build step; Netlify publishes this folder as is (settings in [`../netlify.toml`](../netlify.toml)).

- `index.html`: the landing page (pixel-art stages and the pet).
- `privacy/index.html`: the privacy policy, served at `/privacy`. Keep it in sync with [`../PRIVACY.md`](../PRIVACY.md).

## Update the site
Edit files here and merge to `main`. Netlify deploys on every push to `main` that changes `site/`, and builds a preview link for each pull request.

## Preview locally
```bash
python3 -m http.server 4321 -d site
```
Then open http://localhost:4321.

## Short links
`/install` goes to the Chrome Web Store listing and `/github` to the repo (see `netlify.toml`).
