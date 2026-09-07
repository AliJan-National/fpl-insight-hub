# Deploying FPL Insight Hub

The dashboard is a **static site** — no server runtime needed. Everything is plain HTML/JS/CSS plus a folder of JSON. That means it deploys free to GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

```
fpl_dashboard/
├── index.html      ← the app
├── app.js          ← logic
├── styles.css      ← theme
├── api/*.json      ← all data (rebuilt by refresh.sh)
└── server.py       ← OPTIONAL: local server that adds the /fpl/ proxy
```

## How the FPL "My Team" feature works when deployed

The browser tries three sources in order, automatically:
1. Direct call to `fantasy.premierleague.com/api/…` (fastest, when CORS allows)
2. `/fpl/…` same-origin proxy (only available if you run `server.py`)
3. Public CORS relay (`api.allorigins.win`) — **this is what works on GitHub Pages / Netlify**

So "My Team" works out of the box on free static hosting — no backend required.

## Option A — GitHub Pages (recommended)

1. Create a new repo, e.g. `fpl-insight-hub`.
2. Upload `index.html`, `app.js`, `styles.css` and the whole `api/` folder to the repo root.
3. Repo → **Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
4. Your site is live at `https://<you>.github.io/fpl-insight-hub/`.

## Option B — Netlify (drag & drop, no account setup for Pages)

1. Zip `index.html`, `app.js`, `styles.css` and the `api/` folder into one archive.
2. Go to `app.netlify.com/drop` and drag the zip in.
3. Done — you get a live URL instantly.

## Keeping the data fresh

The JSON is a snapshot. To update it:

```bash
bash fpl_dashboard/refresh.sh
```

This pulls the latest CSVs from the GitHub repo + the live FPL API, then rebuilds every JSON. Re-upload the `api/` folder after running it (GitHub Pages and Netlify both let you redeploy a folder).

For a **fully automatic** site, put `refresh.sh` on a GitHub Actions schedule in your own repo and commit the regenerated `api/` — the same pattern the source repo uses.

## Run it locally (with the faster proxy)

```bash
python3 fpl_dashboard/server.py
# → http://localhost:8000
```

## Attribution

Data: [olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) (free & open). FPL data © Premier League. Keep the footer credit in place.
