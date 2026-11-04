# Triagent for pi issues (Chrome / Edge)

On `github.com/earendil-works/pi/issues/<n>` and `/pull/<n>`:

- A **Triagent** button in the issue header (or floating at the bottom right if GitHub's header markup changes)
  opens `https://triagent.pi.dev/issues/<n>` in a new tab. Triagent redirects that to the list the item is in
  (`/inbox/<n>`, `/open/<n>`, …) and keeps it through login.
- The button shows the triagent status when you are logged in to triagent in the same browser profile:
  `✓ p1` (decided), `p0 · tui · fix` (research suggestion, category, fix ready / PR), `researching…`, `queued`,
  `not researched`, `log in`. Hover for the research summary, reason, duplicates and suggested action.
  It polls while research runs and refreshes when you return to the tab.
- Toolbar button or **Alt+Shift+T** opens the current issue in triagent.

## Install

`chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** → this folder.

## How status works

The service worker calls `GET https://triagent.pi.dev/api/issue?number=<n>`. Because the extension has a host
permission for triagent.pi.dev, CORS does not apply and Chromium treats the request as same-site, so the
`SameSite=Lax` session cookie is sent. No server change needed. Logged out, the API answers 401 → "log in".
PR status is shown only if `/api/issue` knows the number (PRs have their own `/api/pull`).

## Release

Bump `version` in `manifest.json`, commit, then tag and push:

```bash
git tag v0.1.0 && git push origin main v0.1.0
```

`.github/workflows/release.yml` checks the tag matches the manifest version, builds the zip with
`scripts/package.sh`, and attaches it to a GitHub release. Locally, `scripts/package.sh` writes `dist/`.
