# Connect "My Team" with a free Cloudflare proxy (one-time, ~2 minutes)

The official FPL API doesn't allow direct browser calls (no CORS), and free public relays are unreliable.
This tiny **Cloudflare Worker** (100,000 free requests/day) fixes it permanently.

## Setup

1. Go to **[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)** — create a free account (email only, no card).
2. In the left sidebar: **Workers & Pages → Create application → Create Worker**.
3. Give it any name, e.g. `fpl-proxy` → click **Deploy** (the default hello-world code is fine for now).
4. Click **Edit code**, **delete everything**, and paste this:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/fpl\/?/, '');
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    if (!path) return new Response('OK', { headers: cors() });
    const target = 'https://fantasy.premierleague.com/api/' + path + url.search;
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (FPLInsightHub)', 'Accept': 'application/json' },
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  },
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}
```

5. Click **Save and Deploy**.
6. Copy your new URL — it looks like:
   ```
   https://fpl-proxy.YOUR-SUBDOMAIN.workers.dev
   ```
7. On your dashboard, open the **My Team** tab → expand **⚙️ One-time setup** → paste the URL → **Save proxy**.
8. Enter your FPL Team ID and hit **Load My Team**. ✅

The proxy URL is stored only in *your* browser (localStorage).

## If you want every visitor's "My Team" to work

Share that same `workers.dev` URL with them, or bake it in as the default:
in `app.js`, change the line `const custom = (localStorage.getItem('fplProxy') || '')` to
`const custom = (localStorage.getItem('fplProxy') || 'https://fpl-proxy.YOUR-SUBDOMAIN.workers.dev')`
and redeploy.

## Verify it works

```
https://fpl-proxy.YOUR-SUBDOMAIN.workers.dev/entry/1/
```
should return JSON (team info for FPL entry #1).
