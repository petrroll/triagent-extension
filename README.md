# Triagent for pi issues (Chrome / Edge)

Shows triagent's status on earendil-works/pi issues and PRs, and opens them in triagent with one click.

- **Issue and PR lists** (the repo's issue and PR lists, `github.com/issues`, dashboards): after each pi title, a
  small triagent mark plus pills such as `p0`, `providers`, `fix ready`, `fix PR`, `researching`, `queued`,
  `fixed on main`, `duplicate`, `not planned`, `needs info`, `2 new` (comments research did not see), `edited`.
  For PRs: review outcome, `reviewing`, `+N commits`. Clicking anything opens the item in triagent.
- **Issue or PR page:** a **Triagent** button with the same pills (plus `✓ p1` once decided) in the header. If
  GitHub's header markup changes, it floats at the bottom right instead. Hover it for the research summary,
  validity, reproduction, effort and impact, the reason for the suggested priority, and duplicates.
- Links go to `https://triagent.pi.dev/issues/<n>`, which redirects to the list the item is in and keeps it
  through login.
- Status refreshes every minute, every 20s while research runs, and when you come back to the tab.
- Toolbar button or **Alt+Shift+T** opens the current issue in triagent.
- Logged out of triagent: only the mark and a "log in" hint.

## Install

`chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** → this folder.

## How status works

Lists use triagent's own lists, `GET /api/state?list=inbox|open|prs` (three requests for the whole page, cached
for a minute). Items not in those lists (e.g. closed issues) and the issue page use `GET /api/issue?number=<n>`. Because the extension has a host
permission for triagent.pi.dev, CORS does not apply and Chromium treats the request as same-site, so the
`SameSite=Lax` session cookie is sent. No server change needed. Logged out, the API answers 401 → "log in".
A decision (`✓ p1`) shows only on the issue page: triagent's list rows do not include it.

## Release

Bump `version` in `manifest.json`, commit, then tag and push:

```bash
git tag v0.1.0 && git push origin main v0.1.0
```

`.github/workflows/release.yml` checks the tag matches the manifest version, builds the zip with
`scripts/package.sh`, and attaches it to a GitHub release. Locally, `scripts/package.sh` writes `dist/`.
