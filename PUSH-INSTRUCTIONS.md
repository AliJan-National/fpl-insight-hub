# Push FPL Insight Hub to GitHub — 3 commands

## Setup (one-time)

1. Go to https://github.com/new
2. Repo name: `fpl-insight-hub` (or anything you like) — keep it **Public**, don't add README/license
3. Create repository
4. Unzip `fpl-insight-hub.zip` into a folder and open a terminal inside it

## The 3 commands

```bash
git init && git add -A && git commit -m "FPL Insight Hub 2026/27"
git branch -M main && git remote add origin https://github.com/YOUR-USERNAME/fpl-insight-hub.git
git push -u origin main
```

(Replace `YOUR-USERNAME` with your GitHub username. If you have 2FA, Git will ask you to authenticate via browser — just follow the prompt.)

## Enable the free live site (GitHub Pages)

1. Repo on GitHub → **Settings → Pages**
2. Source: **Deploy from a branch** → Branch: **main** → folder: **/ (root)** → Save
3. Wait ~1 minute, then your dashboard is live at:

```
https://YOUR-USERNAME.github.io/fpl-insight-hub/
```

## Updating data later

Run `bash refresh.sh` locally (needs Python + pandas), then:

```bash
git add -A && git commit -m "data refresh" && git push
```
