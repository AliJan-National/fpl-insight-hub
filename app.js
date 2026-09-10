const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DATA = {};

async function load() {
  const names = ['meta', 'league', 'results', 'players', 'radar', 'fixtures', 'news', 'captains', 'prices', 'fplmeta', 'ticker', 'teams', 'history', 'elite'];
  const res = await Promise.all(names.map(n => fetch(`api/${n}.json`).then(r => r.json())));
  names.forEach((n, i) => DATA[n] = res[i]);
  renderAll();
  try { if (typeof fxLedgerRecord === 'function') fxLedgerRecord(); } catch (e) { console.error('[fxLedger]', e); }
  try { ET.init(DATA); } catch (e) { console.error('[ELITE init]', e); }
}

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtK(n) { return n >= 1000 ? (n/1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : n; }
function posBadge(p) { return `<span class="pos ${p}">${p}</span>`; }

function renderAll() {
  const m = DATA.meta;
  $('#gwLabel').textContent = `${m.current_gw_name} · GW${m.latest_gw} complete`;
  $('#gwDeadline').textContent = `Deadline: ${m.deadline} UTC`;
  $('#gwStats').textContent = `Avg score: ${m.avg_score}${m.high_score ? ' · Best: ' + m.high_score : ''}`;
  $('#genDate').textContent = m.generated;
  window.NEXT3_BY_CODE = (DATA.fplmeta && DATA.fplmeta.next3_by_code) || {};
  // single team-form model shared by every tab (same numbers as the Fixtures ticker)
  window.TF = Object.fromEntries((DATA.teams || []).map(t => [t.short, t]));
  (DATA.players || []).forEach(p => {
    p.ep_next = p.ep_next ?? 0; // official expected points (NEVER fall back to p.ep = last-GW event_points)
    const a = (window.TF[p.team] || {}).afx || [];
    (p.next3 || []).forEach((f, i) => {
      if (a[i] != null) { f.adjv = a[i]; f.afdr = Math.max(1, Math.min(5, Math.round(a[i]))); }
    });
  });
  window.adjAvg3 = p => { const v = (p.next3 || []).map(f => f.adjv ?? f.fdr); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 3; };
  window.ownForm = p => (window.TF[p.team] || {}).tf ?? 1;
  window.formRank = p => (window.TF[p.team] || {}).rank || 10;
  window.NEXT_BY_CODE = (DATA.fplmeta && DATA.fplmeta.fixtures_by_code) || window.NEXT3_BY_CODE;
  // v9: one failing tab must never break the buttons wired below or the other tabs
  const safe = (fn, name) => { try { fn(); } catch (e) { console.error('[renderAll]', name, e); } };
  safe(renderLeague, 'league'); safe(renderTopScorers, 'topScorers'); safe(renderResults, 'results');
  safe(renderRadar, 'radar'); safe(renderPlayers, 'players'); safe(renderFixtures, 'fixtures'); safe(renderOsm, 'osm'); safe(renderNews, 'news');
  $('#playerNames').innerHTML = DATA.players.map(p => `<option value="${esc(p.name)}">`).join('');
  $('#cmpGo').onclick = () => { try { renderCompare(); } catch (e) { console.error('[compare]', e); $('#cmpOut').innerHTML = '<p class="hint">⚠️ Compare failed: ' + esc(e.message) + '</p>'; } };
  $('#planSolve').onclick = () => { try { solvePlan(); } catch (e) { console.error('[solvePlan]', e); $('#planOut').innerHTML = '<div class="card"><p class="hint">⚠️ Solver error: <b>' + esc(e.message) + '</b>. Reload My Team and try again.</p></div>'; } };
  $('#wcHorizon').onchange = () => { WC_H = +$('#wcHorizon').value || 3; WC = null; renderWildcard(); };
  safe(renderCaptains, 'captains'); safe(renderPrices, 'prices');
  safe(renderLedger, 'ledger');
  safe(renderLabDigest, 'labDigest');
  safe(renderMarketPulse, 'marketPulse');
  safe(renderVisuals, 'visuals');
}

// ============ Captain & Prices ============
function renderCaptains() {
  $('#captainList').innerHTML = DATA.captains.map((c, i) => `
    <div class="sig-card">
      <div class="rank">${i + 1}</div>
      <div class="sig-info">
        <div class="sig-name">${esc(c.name)} ${posBadge(c.pos)}
          <span class="team-tag">${c.team} · £${c.cost}m · vs ${esc(c.opp)} <span class="fdr f${c.fdr}">${c.fdr}</span></span></div>
        <div class="sig-reasons">${c.reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('')}</div>
      </div>
      <div class="sig-pts"><div class="pts">${c.score}</div><div class="sig-meta">cap score<br>ep ${c.ep}</div></div>
    </div>`).join('');

  const priceRows = (list, dir) => `<tr><th></th><th>Player</th><th class="num">£</th><th class="num">Net</th><th>Chance</th></tr>` +
    list.map(r => `<tr>
      <td>${posBadge(r.pos)}</td><td><b>${esc(r.name)}</b> <span class="team-tag">${r.team}</span></td>
      <td class="num">${r.cost}</td>
      <td class="num ${dir === 'rise' ? 'up' : 'down'}">${r.net > 0 ? '+' : ''}${fmtK(r.net)}</td>
      <td>${dir === 'rise' ? '▲' : '▼'} ${esc(r.label)}</td></tr>`).join('');
  $('#risersTable').innerHTML = priceRows(DATA.prices.risers, 'rise');
  $('#fallersTable').innerHTML = priceRows(DATA.prices.fallers, 'fall');
}
function renderPrices() {} // merged into renderCaptains

// ============ My Team (official FPL API — static-host friendly) ============
// Player/team catalog is pre-baked (api/fplids.json), so only the 3 tiny
// team-specific calls need a live route: direct -> /fpl/ proxy -> YOUR proxy -> relay.
let IDS = null;
async function loadIds() {
  if (!IDS) IDS = await (await fetch('api/fplids.json')).json();
  return IDS;
}
async function fetchWithTimeout(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}
async function fplApi(path) {
  const url = `https://fantasy.premierleague.com/api/${path}`;
  const custom = (localStorage.getItem('fplProxy') || 'https://fpl-proxy.alijanhassan07.workers.dev').trim().replace(/\/+$/, '');
  const attempts = [
    url,
    `/fpl/${path}`,
    ...(custom ? [`${custom}/${path}`] : []),
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  let lastErr;
  for (const u of attempts) {
    try {
      const r = await fetchWithTimeout(u);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const ALL_CHIPS = [['wildcard', 'Wildcard'], ['freehit', 'Free Hit'], ['bboost', 'Bench Boost'], ['3xc', 'Triple Captain']];

async function loadMyTeam() {
  const id = $('#teamId').value.trim();
  const status = $('#teamStatus');
  if (!id) { status.textContent = 'Enter a Team ID first.'; return; }
  status.textContent = 'Loading…';
  try {
    const ids = await loadIds();
    const entry = await fplApi(`entry/${id}/`);
    const hist = await fplApi(`entry/${id}/history/`);
    // find latest gameweek with published picks (current GW may not be processed yet)
    const curGw = DATA.fplmeta.current_gw;
    let picks = null, picksGw = null;
    for (const gw of [curGw, curGw - 1, curGw - 2]) {
      if (gw < 1) continue;
      try {
        const p = await fplApi(`entry/${id}/event/${gw}/picks/`);
        if (p && p.picks && p.picks.length) { picks = p; picksGw = gw; break; }
      } catch (e) { /* try earlier GW */ }
    }
    renderTeam(ids, entry, hist, picks, picksGw);
    status.textContent = '';
  } catch (e) {
    const custom = (localStorage.getItem('fplProxy') || 'https://fpl-proxy.alijanhassan07.workers.dev').trim();
    status.innerHTML = 'Could not load team. If this is a public site, set your free Cloudflare proxy below (one-time, 2&nbsp;min). ' + e.message;
  }
}

// ============ 🔁 SELL? HONESTY (v32) ============
// "SELL?" is only stamped when the engine can name a real, affordable,
// same-position upgrade that out-projects the player over the NEXT 3 GWs by a
// meaningful margin. A hard fixture run alone (e.g. Haaland vs MUN·LIV) is NOT
// a sell signal. Your captain is never pushed to sell. Every figure comes from
// the same forecast spine as the rest of the app — a labelled model estimate.
const SELL_BAR3 = 1.2;        // min next-3 xP advantage to justify a transfer
const SELL_RUN_MAX = 3.0;     // upgrade must face a reasonable run (adj avg <= this)
const TOUGH_RUN_MIN = 3.4;    // player's own run avg that labels "tough run"
function runAvg3Of(p) {
  const v = ((p && p.next3) || []).map(f => f.adjv ?? f.fdr);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 3;
}
function sellUpgrade(cur, bank, ownedIds) {
  if (!cur || typeof hSumP !== 'function') return null;
  const funds = bank + (cur.cost || 0);
  const own3 = hSumP(cur, 3);
  let best = null;
  for (const p of DATA.players || []) {
    if (p.pos !== cur.pos || p.status !== 'a' || (p.mins || 0) < 90) continue;
    if ((p.cost || 0) > funds || ownedIds.has(p.id)) continue;
    if (runAvg3Of(p) > SELL_RUN_MAX) continue;
    const d3 = hSumP(p, 3) - own3;
    if (!best || d3 > best.d3) best = { p, d3 };
  }
  if (!best || best.d3 < SELL_BAR3) return null;
  const f = (typeof forecastOf === 'function') ? forecastOf(best.p) : null;
  return { p: best.p,
    px: f && f.xp != null ? f.xp : Math.round(((best.p.ep_next || 0) + (best.p.form || 0) * 0.5) * 10) / 10,
    d3: Math.round(best.d3 * 10) / 10, funds: Math.round(funds * 100) / 100 };
}
// full tag decision: 'SELL?' only with a real upgrade; 'tough run' otherwise when
// the player's own run is hard and no upgrade clears the bar; captain never SELL.
function sellInfo(cur, o) {
  if (!cur) return { upg: null, tag: null };
  const upg = o && o.isCaptain ? null : sellUpgrade(cur, (o && o.bank) || 0, (o && o.ownedIds) || new Set());
  if (upg) return { upg, tag: 'SELL?' };
  if (!(o && o.isCaptain) && runAvg3Of(cur) >= TOUGH_RUN_MIN) return { upg: null, tag: 'tough run' };
  return { upg: null, tag: null };
}
// ============ 🎨 MY TEAM CHARTS (v33) ============
// Pure presentational builders — all data is passed in from renderTeam so every
// chart is deterministic and unit-testable. Real figures are official history;
// projections come from the same forecast spine, labelled as model estimates.

// (1) Your weekly score: real bars + model projection line across next 5 GWs
function teamMomChart(real, proj, alt) {
  // Optional 3rd series (alt) = the edited team drawn by the Team Lab; a plain
  // two-argument call renders exactly what v33 shipped (real bars + one line).
  if ((!real || !real.length) && (!proj || !proj.length) && (!alt || !alt.length)) return '';
  const pts = (real || []).concat(proj || []).concat(alt || []).map(p => p.v).concat([0]);
  const rawMax = Math.max.apply(null, pts);
  const step = rawMax <= 60 ? 10 : rawMax <= 120 ? 20 : 50;
  const yMax = Math.max(step, Math.ceil(rawMax / step) * step);
  const W = 760, H = 258, L = 46, R = 14, T = 30, B = 50;
  const n = real.length + (proj || []).length, band = (W - L - R) / Math.max(n, 1);
  const X = i => L + band * (i + 0.5);
  const Y = v => T + (H - T - B) * (1 - v / yMax);
  let g = '';
  for (let s = 0; s <= yMax; s += step) {
    const y = Y(s);
    g += `<line x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,${s === 0 ? 0.25 : 0.08})" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#8a93a6">${s}</text>`;
  }
  let i = 0;
  real.forEach(p => {
    const x = X(i), y = Y(p.v), h = (H - T - B) - (y - T);
    g += `<rect x="${(x - band * 0.34).toFixed(1)}" y="${y.toFixed(1)}" width="${(band * 0.68).toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" rx="4" fill="#4dc3ff" opacity="0.9"><title>GW${p.gw}: real ${p.v} pts</title></rect>`;
    g += `<text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="11" fill="#cfe3ff" font-weight="700">${Math.round(p.v)}</text>`;
    i++;
  });
  if (real.length && (proj || []).length) {
    const sx = L + band * (real.length - 0.5);
    g += `<line x1="${sx.toFixed(1)}" y1="${T}" x2="${sx.toFixed(1)}" y2="${H - B}" stroke="rgba(255,209,102,.55)" stroke-dasharray="4 4"/>`;
  }
  const lineFn = (list, color, dash, tag, label) => {
    const coords = list.map((p, k) => { const x = L + band * (real.length + k + 0.5); return { x, y: Y(p.v), p }; });
    if (!coords.length) return;
    const pts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>`;
    coords.forEach(c => {
      g += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="#0d1117" stroke="${color}" stroke-width="2"><title>GW${c.p.gw}: model ~${c.p.v.toFixed(1)} pts (${tag})</title></circle>`;
      g += `<text x="${c.x.toFixed(1)}" y="${(c.y - 9).toFixed(1)}" text-anchor="middle" font-size="11" fill="${label}">${c.p.v.toFixed(1)}</text>`;
    });
  };
  if ((proj || []).length) lineFn(proj, '#ffd166', '6 5', 'your team', '#ffe9a8');
  if (alt && alt.length) lineFn(alt, '#3fb950', '2 3', 'edited team', '#b6f7c2');
  real.forEach((p, k) => { const x = X(k); g += `<text x="${x.toFixed(1)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="#8a93a6">GW${p.gw}</text>`; });
  (proj || []).forEach((p, k) => { const x = X(real.length + k); g += `<text x="${x.toFixed(1)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="#ffe9a8">GW${p.gw}</text>`; });
  g += `<text x="${L}" y="16" font-size="11" fill="#cfe3ff">■ real score</text>`;
  if ((proj || []).length) g += `<text x="${L + 118}" y="16" font-size="11" fill="#ffe9a8">┄ model projection</text>`;
  if (alt && alt.length) g += `<text x="${L + 246}" y="16" font-size="11" fill="#b6f7c2">┄ edited team</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>Your weekly score: real (bars) vs model projection (dashed line)</title>${g}</svg>`;
}

// (2) Next-5 fixture difficulty heat map — one row per squad player
function squadHeatHtml(squad, picksGw) {
  if (!squad || !squad.length) return '';
  const cur = picksGw || ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3);
  const first = cur + 1, K = 5;
  const cols = ['#166a43', '#2a7d52', '#b98530', '#c0652c', '#a3312f'];   // adjFDR 1..5
  const rows = squad.slice().sort((a, b) => {
    const ab = a.r && a.r.position <= 11 ? 0 : 1, bb = b.r && b.r.position <= 11 ? 0 : 1;
    return ab !== bb ? ab - bb : (a.r ? a.r.position : 0) - (b.r ? b.r.position : 0);
  });
  const head = `<span style="display:inline-block;min-width:116px;font-size:12px;color:#8a93a6">player</span>` +
    Array.from({ length: K }, (_, k) => `<span style="display:inline-block;min-width:96px;font-size:11px;color:#8a93a6;text-align:center">GW${first + k}</span>`).join('');
  const body = rows.map(s => {
    const e = s.e || {};
    const bench = s.r ? s.r.position > 11 : false;
    const cap = s.r && s.r.is_captain ? ' 👑' : '';
    const nm = esc(e.n || ('#' + (s.r ? s.r.element : '?')));
    const cells = [];
    for (let k = 0; k < K; k++) {
      const f = (s.fxs || [])[k];
      if (!f) { cells.push('<span style="display:inline-block;min-width:96px;text-align:center;font-size:11px;color:#5a6a85">—</span>'); continue; }
      const a = Math.max(1, Math.min(5, Math.round(f.afdr ?? f.fdr ?? 3)));
      const bg = cols[a - 1];
      cells.push(`<span title="GW${first + k}: ${f.opp} (${f.ha === 'H' ? 'home' : 'away'}) · difficulty ${a}/5" style="display:inline-block;min-width:96px;margin:1px 0;background:${bg};color:#fff;border-radius:6px;padding:2px 6px;font-size:11px;text-align:center;box-sizing:border-box;opacity:${bench ? 0.5 : 1}">${esc(f.opp)} <i style="font-style:normal;opacity:.85">${f.ha === 'H' ? 'H' : 'A'}</i> <b>${a}</b></span>`);
    }
    const nmSpan = `<span style="display:inline-block;min-width:116px;font-size:12px;opacity:${bench ? 0.55 : 1}">${nm}${cap}${bench ? ' <span class="xb" style="--c:var(--amber)">B</span>' : ''}</span>`;
    return `<div style="margin:1px 0">${nmSpan}${cells.join('')}</div>`;
  }).join('');
  const legend = `<span style="font-size:10px;color:#8a93a6">1 easy</span> ` +
    [1, 2, 3, 4, 5].map(a => `<span style="display:inline-block;width:14px;height:10px;background:${cols[a - 1]};border-radius:3px;margin:0 1px"></span>`).join('') +
    `<span style="font-size:10px;color:#8a93a6"> 5 hard</span>`;
  return `<div>${head}<br>${body}</div><div style="margin-top:6px">${legend}</div>`;
}

// (3) Squad shape — one stacked bar of where the next-GW xP sits, by line
function posStackHtml(xi, bench) {
  if ((!xi || !xi.length) && (!bench || !bench.length)) return '';
  const orders = ['GK', 'DEF', 'MID', 'FWD'];
  const names = { GK: 'goalkeepers', DEF: 'defence', MID: 'midfield', FWD: 'attack' };
  const colors = { GK: '#7a8bb0', DEF: '#4dc3ff', MID: '#00e28a', FWD: '#ffd166' };
  const pn = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  const tot = {}, cnt = {};
  (xi || []).forEach(s => { const k = pn[s.pos] || 'MID'; tot[k] = (tot[k] || 0) + (s.ep || 0); cnt[k] = (cnt[k] || 0) + 1; });
  const bTot = (bench || []).reduce((a, s) => a + (s.ep || 0), 0);
  const allTot = orders.reduce((a, k) => a + (tot[k] || 0), 0);
  const maxTot = Math.max(allTot, 1);
  let segs = '';
  orders.forEach(k => {
    const t = tot[k] || 0; if (t <= 0.005) return;
    const w = Math.max(2.2, t / maxTot * 100);
    segs += `<div title="${names[k]} (${cnt[k] || 0} starters): ${t.toFixed(1)} xP" style="display:inline-block;height:26px;width:${w.toFixed(1)}%;min-width:${t > 0.5 ? 14 : 6}px;background:${colors[k]};opacity:.88;vertical-align:bottom;border-radius:3px 0 0 3px"></div>`;
  });
  const legend = orders.map(k => `<span style="font-size:11px;color:#cfd6e4"><i style="background:${colors[k]};display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px"></i>${names[k]} <b>${(tot[k] || 0).toFixed(1)}</b></span>`).join('');
  const benchNote = bench && bench.length
    ? `<p class="muted" style="margin-top:8px;margin-bottom:0">Bench (${bench.length} players) holds <b>${bTot.toFixed(1)} xP</b> — ${bTot >= 4 ? '<span style="color:var(--amber)">that is dead money this week; one tidy upgrade beats repeated -4 hits.</span>' : 'decent cover if someone misses out.'}</p>` : '';
  return `<div style="width:100%;background:rgba(255,255,255,.05);border-radius:6px;overflow:hidden;display:flex">${segs}<div style="flex:1"></div></div><div style="margin-top:7px;display:flex;gap:14px;flex-wrap:wrap">${legend}</div>${benchNote}`;
}

function renderTeam(ids, entry, hist, picks, picksGw) {
  // compact catalog: elements by id, teams by FPL team id
  const elById = ids.elements;
  const teamById = ids.teams;
  $('#teamDetail').style.display = '';

  const eh = picks ? picks.entry_history : {};
  $('#teamSummary').innerHTML = `
    <div class="team-stats">
      <div class="tstat"><div class="v">${esc(entry.name)}</div><div class="k">Team</div></div>
      <div class="tstat"><div class="v">${(eh.overall_rank || entry.summary_overall_rank || 0).toLocaleString()}</div><div class="k">Overall rank</div></div>
      <div class="tstat"><div class="v">${eh.total_points ?? entry.summary_overall_points ?? '—'}</div><div class="k">Total points</div></div>
      <div class="tstat"><div class="v">£${((eh.value ?? 1000) / 10).toFixed(1)}m</div><div class="k">Team value</div></div>
      <div class="tstat"><div class="v">£${((eh.bank ?? 0) / 10).toFixed(1)}m</div><div class="k">In the bank</div></div>
      <div class="tstat"><div class="v">GW${picksGw}</div><div class="k">Latest picks</div></div>
    </div>`;

  // next-fixture maps per team code (3 and 5 lookahead)
  const flags = DATA.fplmeta.schedule_flags || {};
  const NEXT = window.NEXT_BY_CODE || {};
  // v9: NEXT is keyed by team CODE but the catalog by team ID — map codes correctly (was: wrong team's form shift)
  const teamByCode = {}; Object.values(teamById).forEach(t => { if (t && t.code != null) teamByCode[t.code] = t; });
  Object.entries(NEXT).forEach(([code, arr]) => {
    const t = teamByCode[code] || teamById[code]; const a = (window.TF[t && t.short] || {}).afx || [];
    (arr || []).forEach((f, i) => { if (a[i] != null) { f.adjv = a[i]; f.afdr = Math.max(1, Math.min(5, Math.round(a[i]))); } });
  });

  // ---- Enriched squad ----
  const posName = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  const fdrMult = { 1: 1.15, 2: 1.08, 3: 1, 4: 0.92, 5: 0.85 };
  const avg = (arr, n) => { const a = (arr || []).slice(0, n); return a.length ? a.reduce((s, f) => s + (f.adjv ?? f.fdr), 0) / a.length : 3; };

  const squad = (picks ? picks.picks : []).map(r => {
    const e = elById[r.element];
    const t = e ? teamById[e.t] : null;
    const fxs = t ? (NEXT[t.code] || []) : [];
    // v30 single forecast brain: s.ep = OUR model xP when the player is in the
    // catalog (official FPL ep_next stays available as s.oep for reference).
    const mxp = e ? modelXpById(r.element) : null;
    return { r, e, t, fxs, pos: e ? e.et : 2,
      ep: mxp != null ? mxp : (e ? (e.ep || 0) : 0),
      oep: e ? (e.ep || 0) : 0, mxFromModel: mxp != null,
      a3: avg(fxs, 3), a5: avg(fxs, 5), flagged: !!(e && e.s && e.s !== 'a') };
  }).sort((a, b) => a.r.position - b.r.position);
  const ownedIds = new Set(squad.map(s => s.r.element));
  const capScore = s => (s.ep != null ? s.ep : 0); // captain rank == the model xP (single voice)

    // ---- Projected best XI: legal 11-man FPL formation (fixes the old 9-player cut) ----
  const xi = bestXI(squad, s => s.ep) || squad.slice(0, 11);
  const xiSet = new Set(xi.map(s => s.r.element));
  const capRank = [...xi].sort((a, b) => capScore(b) - capScore(a));
  const capPick = capRank[0];
  const capAlt = capRank[1];
  const proj = xi.reduce((s, p) => s + p.ep, 0) + (capPick ? capPick.ep : 0);
  const bench = squad.filter(s => !xiSet.has(s.r.element));
  const benchWaste = bench.reduce((s, p) => s + p.ep, 0);
  const userCap = squad.find(s => s.r.is_captain);
  const capTop3 = new Set([...squad].sort((a, b) => capScore(b) - capScore(a)).slice(0, 3).map(s => s.r.element));

  const catMap = {};
  (DATA.players || []).forEach(p => { catMap[p.id] = p; });
  const bank = (eh.bank ?? 0) / 10;
  squad.forEach(s => {
    s.cap = capScore(s);
    const v = [];
    const inXI = xiSet.has(s.r.element);
    const cur = catMap[s.r.element];
    if (s.flagged) {
      v.push(['⚠ FLAG', 'vd-sell']);
      v.push(inXI ? ['START', 'vd-start'] : ['BENCH', 'vd-bench']);
    } else {
      v.push(inXI ? ['START', 'vd-start'] : ['BENCH', 'vd-bench']);
      if (capTop3.has(s.r.element)) v.push(['C OPT', 'vd-cap']);
      const si = sellInfo(cur, { isCaptain: !!s.r.is_captain, bank, ownedIds });
      s._upg = si.upg;
      if (si.tag === 'SELL?') v.push(['SELL?', 'vd-sell']);
      else if (si.tag === 'tough run') v.push(['tough run', 'vd-warn']);
    }
    s.verdicts = v;
  });

  // ---- XI summary (11 cells; bench holds the remaining 4) ----
  const xiCells = xi.map(s => `<div class="xi-cell ${capPick && s.r.element === capPick.r.element ? 'capt' : ''}" title="${s.mxFromModel ? 'model xP ' + s.ep.toFixed(1) + ' · official FPL xP ' + s.oep.toFixed(1) : 'model xP (official FPL fallback)'}">
      <div>${esc(s.e ? s.e.n : '?')}</div><div class="ep">${s.ep.toFixed(1)}</div>
      <div class="fn">${posName[s.pos]} · ${(s.fxs[0] || {}).opp || '—'}${(s.fxs[0] || {}).ha === 'H' ? '(H)' : '(A)'}</div>
    </div>`).join('');

  $('#xiSummary').innerHTML = `
    <div class="xi-wrap">
      <div class="xi-stats">
        <div class="tstat"><div class="v">${proj.toFixed(1)}</div><div class="k">Projected pts</div></div>
        <div class="tstat"><div class="v">${benchWaste.toFixed(1)}</div><div class="k">Bench waste</div></div>
        <div class="tstat"><div class="v">${capPick ? esc(capPick.e.n) : '—'}</div><div class="k">Suggested captain${capAlt ? ' · alt: ' + esc(capAlt.e.n) : ''}</div></div>
        <div class="tstat"><div class="v">${userCap && userCap.e ? esc(userCap.e.n) : '—'}</div><div class="k">Your GW${picksGw} captain</div></div>
      </div>
      <div class="xi-pitch">${xiCells}</div>
    </div>`;

  // ---- Squad list with verdicts (fixtures labelled by gameweek) ----
  const firstGw = picksGw + 1;
  const squadHtml = squad.map(s => {
    if (!s.e) return '';
    const fxTxt = s.fxs.slice(0, 3).map((f, i) =>
      `<span title="GW${firstGw + i}: ${f.opp} (${f.ha === 'H' ? 'Home' : 'Away'})">${f.opp}(${f.ha})<i class="fx-gw">${f.gw}</i><span class="fdr f${f.fdr}" style="margin:0 2px">${f.fdr}</span></span>`).join(' ');
    const capt = s.r.is_captain ? '<span class="badge-c">C</span>' : s.r.is_vice_captain ? '<span class="badge-v">V</span>' : '';
    const vd = s.verdicts.map(([t, c]) => `<span class="vd ${c}">${t}</span>`).join('');
    return `<div class="squad-row ${s.r.is_captain ? 'captain' : ''}">
      ${capt}<span class="pos ${posName[s.pos]}">${posName[s.pos]}</span>
      <span class="nm">${esc(s.e.n)}${s.flagged ? ' ⚠️' : ''}${vd} <span class="team-tag">${s.t ? s.t.short : ''}</span></span>
      <span class="fix">${fxTxt}</span>
      <span class="team-tag" title="${s.mxFromModel ? 'model xP ' + s.ep.toFixed(1) + ' · official FPL xP ' + s.oep.toFixed(1) : 'model xP (fallback to official FPL xP)'}">xP ${s.ep.toFixed(1)}</span>
      <b class="pts">${s.e.pts ?? '—'}</b><span class="team-tag">£${(s.e.c / 10).toFixed(1)}</span>
    </div>`;
  }).join('');
  $('#squadList').innerHTML =
    `<p class="hint">Fixture chips show <b>GW${firstGw}–${firstGw + 2}</b> (small number = gameweek). Right column: season points &amp; price.</p>` +
    (squadHtml || '<p class="hint">No picks published yet.</p>');

  // ---- Captaincy in squad (form + fixture reasons) ----
  $('#capSquadList').innerHTML = [...squad].sort((a, b) => b.cap - a.cap).slice(0, 3).map((s, i) => {
    const f0 = s.fxs[0] || {};
    const frm = s.e.form || 0;
    const reasons = [];
    if ((f0.fdr || 3) <= 2) reasons.push(`Easy GW${f0.gw}: ${f0.opp}(${f0.ha})`);
    else if ((f0.fdr || 3) >= 4) reasons.push(`Tough GW${f0.gw}: ${f0.opp}(${f0.ha})`);
    if (frm >= 7) reasons.push(`In form (${frm})`);
    if (s.ep >= 7) reasons.push(`High xP (${s.ep.toFixed(1)})`);
    return `
    <div class="sig-card">
      <div class="rank">${i + 1}</div>
      <div class="sig-info">
        <div class="sig-name">${esc(s.e.n)} ${posBadge(posName[s.pos])}
          <span class="team-tag">GW${f0.gw || firstGw}: ${f0.opp || '—'}(${f0.ha || '?'}) <span class="fdr f${f0.fdr || 3}">${f0.fdr || 3}</span></span></div>
        <div class="sig-reasons">${reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('') || `<span class="reason">form ${frm}</span>`}</div>
        ${ML.ready ? `<div class="sig-reasons">${ML.capLens(s)}</div>` : ''}
      </div>
      <div class="sig-pts"><div class="pts">${s.cap.toFixed(1)}</div><div class="sig-meta">model xP<br>form ${frm}</div></div>
    </div>`;
  }).join('') || '<p class="hint">—</p>';

  // ---- Suggested transfer pairs ----
  const pairs = squad.filter(s => s._upg && s.verdicts.some(x => x[0] === 'SELL?'))
    .sort((a, b) => b._upg.d3 - a._upg.d3).slice(0, 3);
  $('#pairsList').innerHTML = pairs.map(pr => {
    const u = pr._upg;
    const outNm = (pr.e && pr.e.n) ? pr.e.n : '#?';
    return `<div class="pair-card">
      <div class="who"><b class="down">${esc(outNm)}</b> <span class="team-tag">${pr.t ? pr.t.short : ''} · £${(pr.e && pr.e.c ? pr.e.c / 10 : 0).toFixed(1)}m · xP ${pr.ep.toFixed(1)}</span></div>
      <span class="arrow">→</span>
      <div class="who"><b class="up">${esc(u.p.name)}</b> <span class="team-tag">${u.p.team} · £${u.p.cost}m · xP ${u.px.toFixed(1)}</span></div>
      <div class="delta"><span class="up">+${u.d3.toFixed(1)}</span><div class="sig-meta">Δ next-3 xP · funds £${u.funds.toFixed(1)}m ✓</div></div>
    </div>`;
  }).join('') || '<p class="hint">No affordable, clearly positive moves right now — holding is fine. "SELL?" only appears when a same-position upgrade out-projects the player over the next 3 GWs.</p>';
  const sh = $('#sellHint'); if (sh) sh.textContent = 'SELL? = a real upgrade beats this player over the next 3 GWs (Δ above). A hard fixture run with no upgrade = hold. Your captain is never pushed to sell.';

  // ---- GW-by-GW game plan (hold / bench-sell / buy) ----
  const benchVals = bench.map(s => (s.e ? s.e.c / 10 : 0)).sort((a, b) => b - a);
  const maxFund = bank + (benchVals[0] || 0) + 0.05;
  const planHtml = [0, 1, 2].map(i => {
    const g = firstGw + i;
    const scored = squad.map(s => ({ s, f: s.fxs[i], sc: (s.oep || s.ep) * (fdrMult[(s.fxs[i] || {}).afdr || (s.fxs[i] || {}).fdr || 3] || 1) * (0.9 + 0.1 * ownForm(s)) }))
      .filter(x => x.f);
    const holds = scored.filter(x => x.f.fdr <= 3).sort((a, b) => b.sc - a.sc).slice(0, 3);
    const risks = scored.filter(x => x.f.fdr >= 4).sort((a, b) => a.f.fdr - b.f.fdr).slice(0, 3);
    const tgt = DATA.players
      .filter(p => !ownedIds.has(p.id) && p.status === 'a' && p.mins >= 90 && p.cost <= maxFund && ((p.next3[i] || {}).afdr ?? (p.next3[i] || {}).fdr ?? 3) <= 2)
      .sort((a, b) => (b.ep_next + ownForm(b)) - (a.ep_next + ownForm(a)))
      .sort((a, b) => ((b.form || 0) + (b.ep_next || 0)) - ((a.form || 0) + (a.ep_next || 0)))[0];
    return `<div class="advice"><b>GW${g}:</b>
      ${holds.length ? `<br>✅ <b>Hold/start:</b> ${holds.map(x => `${esc(x.s.e.n)} <span class="fdr f${x.f.fdr}">${x.f.fdr}</span>`).join(', ')}` : ''}
      ${risks.length ? `<br>🔻 <b>Bench/sell:</b> ${risks.map(x => `${esc(x.s.e.n)} <span class="fdr f${x.f.fdr}">${x.f.fdr}</span> ${x.f.opp}(${x.f.ha})`).join(', ')}` : ''}
      ${tgt ? `<br>🛒 <b>Buy option (≤£${maxFund.toFixed(1)}m):</b> ${esc(tgt.name)} (${tgt.team}, £${tgt.cost}m) — ${ (tgt.next3[i] || {}).opp }(${(tgt.next3[i] || {}).ha}) <span class="fdr f${(tgt.next3[i] || {}).fdr}">${(tgt.next3[i] || {}).fdr}</span>` : '<br>🛒 No affordable buy with easy fixtures this GW.'}
    </div>`;
  }).join('');
  $('#gamePlan').innerHTML = `<p class="hint">One free transfer per GW. Budget for buys: £${maxFund.toFixed(1)}m (bank + priciest bench sale).</p>` + planHtml;

  // ---- Fixture swing table ----
  const groups = {};
  squad.forEach(s => {
    if (!s.t || !s.e) return;
    const g = groups[s.t.code] || (groups[s.t.code] = { short: s.t.short, a5: s.a5, fxs: s.fxs, names: [] });
    g.names.push(s.e.n);
  });
  const swingRows = Object.values(groups).sort((a, b) => a.a5 - b.a5).map(g => {
    const cls = g.a5 <= 2.2 ? 'swing-good' : g.a5 <= 3 ? 'swing-mid' : 'swing-bad';
    const fx = g.fxs.slice(0, 5).map(f => `<span class="fx-gw">${f.gw}</span><span class="fdr f${f.fdr}" style="margin:0 1px">${f.fdr}</span>`).join(' ');
    return `<tr><td><b>${g.short}</b></td><td style="white-space:normal">${g.names.join(', ')}</td>
      <td>${fx}</td><td class="num ${cls}">${g.a5.toFixed(1)}</td></tr>`;
  }).join('');
  $('#swingTable').innerHTML = `<tr><th>Club</th><th>Your players</th><th>Next 5</th><th class="num">Avg</th></tr>${swingRows}`;

  // ---- Recent transfers ----
  const trs = (hist.transfers || []).slice(-6).reverse();
  $('#transferHist').innerHTML = trs.map(t => `
    <div class="tr-row"><span class="gw-tag">GW${t.event}</span>
      <span class="up">+ ${esc(elById[t.element_in] ? elById[t.element_in].n : '?')}</span>
      <span class="down">− ${esc(elById[t.element_out] ? elById[t.element_out].n : '?')}</span></div>`).join('')
    || '<p class="hint">No transfers yet this season.</p>';

  // ---- Budget & targets ----
  $('#budgetHint').innerHTML = `Funds if you sell your priciest bench player: <b>£${maxFund.toFixed(1)}m</b> (bank £${bank.toFixed(1)}m). Targets below fit that slot and have kind next-3 fixtures.`;

  const next3avg = (n3) => n3.length ? n3.reduce((s, f) => s + (f.adjv ?? f.fdr), 0) / n3.length : 3;
  const targets = DATA.players
    .filter(p => !ownedIds.has(p.id) && p.cost <= maxFund && p.mins >= 90 && (p.status === 'a'))
    .filter(p => next3avg(p.next3) <= 2.8)
    .map(p => ({ p, avg: next3avg(p.next3), score: p.form * 2 + p.ep_next + (3 - next3avg(p.next3)) * 2 + ownForm(p) * 2 }))
    .sort((a, b) => b.score - a.score).slice(0, 8);
  $('#targetsList').innerHTML = targets.map(({ p, avg }, i) => `
    <div class="sig-card">
      <div class="rank">${i + 1}</div>
      <div class="sig-info">
        <div class="sig-name">${esc(p.name)} ${posBadge(p.pos)} <span class="team-tag">${p.team} · £${p.cost}m · ${p.own}% owned · form #${formRank(p)}${ML.ready ? ' · ' + ML.ownCount(p) + '/' + ML.n + ' rivals own' : ''}</span></div>
        <div class="sig-reasons">
          <span class="reason">Next: ${p.next3.slice(0, 3).map(f => `${f.opp}(${f.ha})<span class="fdr f${f.afdr ?? f.fdr}" style="margin:0 2px">${f.afdr ?? f.fdr}</span>`).join(' ') || '—'} · adj FDR ${avg.toFixed(1)}</span>
          <span class="reason">Form ${p.form} · ep ${p.ep_next}</span>
        </div>
      </div>
      <div class="sig-pts"><div class="pts">${p.pts}</div><div class="sig-meta">pts</div></div>
    </div>`).join('') || '<p class="hint">No affordable targets with easy fixtures right now.</p>';

  // ---- Chips ----
  const used = new Set((hist.chips || []).map(c => c.name));
  const pills = ALL_CHIPS.map(([key, label]) =>
    `<span class="chip-pill ${used.has(key) ? 'chip-used' : 'chip-avail'}">${label}${used.has(key) ? ' (used)' : ''}</span>`).join('');

  // DGW/BGW scan next 4 GWs for YOUR players' teams
  const myTeamCodes = Object.keys(groups);
  const gwNotes = [];
  for (let ev = picksGw + 1; ev <= picksGw + 4; ev++) {
    const dgws = myTeamCodes.filter(c => (flags[c] || {})[ev] >= 2);
    const bgws = myTeamCodes.filter(c => !((flags[c] || {})[ev] >= 1));
    if (dgws.length) gwNotes.push(`GW${ev}: your players from <b>${dgws.length}</b> team(s) have a <span class="dgw-tag">DOUBLE</span>`);
    if (bgws.length) gwNotes.push(`GW${ev}: players from <b>${bgws.length}</b> team(s) have a <span class="bgw-tag">BLANK</span>`);
  }
  let advice = `<div>${pills}</div>`;
  if (gwNotes.length) advice += gwNotes.map(n => `<div class="advice">${n}</div>`).join('');
  const chipsLeft = ALL_CHIPS.filter(([k]) => !used.has(k)).length;
  if (!used.has('wildcard')) {
    const flagged = squad.filter(s => s.flagged).length;
    if (flagged >= 2) advice += `<div class="advice">⚠️ You have <b>${flagged}</b> flagged players — a Wildcard could reset your squad.</div>`;
    else advice += `<div class="advice">Wildcard still available — consider saving it for a double gameweek or injury crisis.</div>`;
  }
  if (chipsLeft === 0) advice += `<div class="advice">All chips used — pure transfers from here!</div>`;
  $('#chipAdvice').innerHTML = advice;

  // ---- 🎨 v33 charts (pure builders; guarded so a chart failure never breaks My Team) ----
  try {
    if (typeof teamMomChart === 'function' && typeof projP === 'function' && typeof bestXI === 'function') {
      const catSquad = squad.map(s => catMap[s.r.element]).filter(Boolean);
      const realSeries = (hist.current || []).filter(e => e && e.event && e.event <= picksGw)
        .map(e => ({ gw: e.event, v: Math.round((e.points || 0) * 10) / 10 }))
        .sort((a, b) => a.gw - b.gw);
      const projSeries = [];
      if (catSquad.length) {
        for (let k = 0; k < 5; k++) {
          const xiK = bestXI(catSquad, p2 => projP(p2, k)) || catSquad.slice(0, 11);
          let tot = 0; xiK.forEach(p2 => { tot += projP(p2, k); });
          const capV = xiK.length ? Math.max.apply(null, xiK.map(p2 => projP(p2, k))) : 0;
          projSeries.push({ gw: picksGw + 1 + k, v: Math.round((tot + capV) * 10) / 10 });
        }
      }
      const momEl = $('#teamMom'); if (momEl) momEl.innerHTML = teamMomChart(realSeries, projSeries);
      const momH = $('#momHint');
      if (momH) momH.textContent = realSeries.length
        ? 'Bars = your real weekly score (official entry history). Dashed line = model best-XI + captain projection (next 5 GWs, labelled estimate).'
        : 'Real bars appear once your entry history loads; the dashed line is the model best-XI + captain projection for the next 5 GWs (labelled estimate).';
    }
  } catch (e) { console.error('[teamMom]', e); }
  try {
    const heatEl = $('#squadHeat'); if (heatEl && typeof squadHeatHtml === 'function') heatEl.innerHTML = squadHeatHtml(squad, picksGw);
    const heatH = $('#heatHint');
    if (heatH) heatH.textContent = 'Rows: your projected starters first, bench dimmed (B). Cells coloured by adjusted difficulty 1–5 — your best transfer/bench windows at a glance.';
  } catch (e) { console.error('[squadHeat]', e); }
  try {
    const posEl = $('#posStack'); if (posEl && typeof posStackHtml === 'function') posEl.innerHTML = posStackHtml(xi, bench);
  } catch (e) { console.error('[posStack]', e); }

  // ---- 🧪 Team Lab (v34): interactive swap experiment (guarded) ----
  try { if (typeof renderTeamLab === 'function') renderTeamLab(ids, squad, picksGw, bank, hist); }
  catch (e) { console.error('[teamLab]', e); }

  // ---- hand context to the Assistant ----
  window.TEAMCTX = {
    squad, bank, maxFund, picksGw,
    entryId: entry.id,
    entryName: entry.name,
    totalPts: eh.total_points ?? entry.summary_overall_points ?? 0,
    rank: eh.overall_rank || entry.summary_overall_rank || 0,
    value: (eh.value ?? 1000) / 10,
    proj, benchWaste,
    usedChips: [...used], chipsLeft: ALL_CHIPS.filter(([k]) => !used.has(k)).map(([, l]) => l),
  };
}

// ============ 🧪 TEAM LAB (v34) ============
// Interactive squad editor inside My Team. Pick a replacement for any slot (same
// position, real players only) and the projection / charts recompute instantly
// on the SAME spine as the rest of the app (best-XI + captain, one forecast).
// It is an experiment surface only — nothing is saved to FPL. Every figure is a
// labelled model estimate from real data. The pure core (labUniverse / labEpOf /
// labRawOf / labTotal / labSeries / labCompute / labCandidateList) is
// deterministic and regression-tested; rendering is guarded at the call site so
// a lab failure can never break My Team.
const LAB_POS_L = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// one flat player record for the lab: official element meta + catalog overlay
function labUniverse(ids) {
  const catById = {};
  (DATA.players || []).forEach(p => { if (p && p.id != null) catById[p.id] = p; });
  const els = (ids && ids.elements) || {}, teams = (ids && ids.teams) || {};
  const out = [];
  Object.keys(els).forEach(k => {
    const id = +k, el = els[k] || {}, p = catById[id] || null;
    const t = teams[el.t] || {};
    const posN = el.et;
    out.push({
      id, el, p,
      name: p ? p.name : (el.n || '#?'),
      short: t.short || '', code: t.code != null ? t.code : null,
      pos: posN, posL: LAB_POS_L[posN] || (p && p.pos) || 'MID',
      cost: p ? +(p.cost || 0) : +((el.c || 0) / 10),
      form: +(p ? (p.form != null ? p.form : el.form) : (el.form || 0)),
      own: p ? (p.own || 0) : 0,
      pts: p ? (p.pts != null ? p.pts : el.pts) : (el.pts || 0),
      mins: p ? (p.mins || 0) : (el.mins || 0),
      status: (p ? p.status : el.s) || 'a',
    });
  });
  return out;
}
// next-GW model xP (rounded, card style) — the SAME number the Best XI card shows
function labEpOf(u) {
  if (u._ep === undefined) {
    let v = null;
    if (u.p) { try { const f = forecastOf(u.p); v = f && f.xp != null ? f.xp : null; } catch (e) { v = null; } }
    if (v == null && u.el && u.el.ep != null) v = u.el.ep; // official reference only when the model has no record
    u._ep = v == null ? 0 : v;
  }
  return u._ep;
}
// raw per-GW projection (chart spine) — same series the weekly-score chart draws
function labRawOf(u, k) {
  if (u.p) { try { return projP(u.p, k); } catch (e) { /* fall through */ } }
  return (u.el && u.el.ep != null) ? u.el.ep : 0;
}
// next-5 fixtures for a player's club, aligned to picksGw (cloned cells)
function labFxsOf(u, picksGw) {
  const arr = (window.NEXT_BY_CODE && u.code != null) ? (window.NEXT_BY_CODE[u.code] || null) : null;
  const a = (window.TF && u.short && window.TF[u.short]) ? (window.TF[u.short].afx || []) : [];
  const out = [];
  if (!arr) return out;
  for (let i = 0; i < 5 && i < arr.length; i++) {
    const f = arr[i] || {};
    const adj = a[i];
    const have = adj != null;
    const fdr = f.fdr || 3;
    out.push({
      gw: f.gw || (picksGw + 1 + i), opp: f.opp || '—', ha: f.ha || '?', fdr,
      adjv: have ? adj : (f.adjv != null ? f.adjv : fdr),
      afdr: Math.max(1, Math.min(5, Math.round(have ? adj : (f.afdr != null ? f.afdr : fdr)))),
    });
  }
  return out;
}
// best-XI + captain total, card style (per-player rounded xP) -> {tot, xi, capId}
function labTotal(list) {
  const xi = (typeof bestXI === 'function' ? bestXI(list, u => labEpOf(u)) : null) || list.slice(0, 11);
  let s = 0, mx = 0, capId = null;
  xi.forEach(u => { const e = labEpOf(u); s += e; if (e > mx) { mx = e; capId = u.id; } });
  return { tot: s + mx, xi, cap: mx, capId };
}
// next-5 chart series (raw spine) — mirrors the weekly-score projection line
function labSeries(list, picksGw) {
  const arr = [];
  for (let k = 0; k < 5; k++) {
    const xiK = (typeof bestXI === 'function' ? bestXI(list, u => labRawOf(u, k)) : null) || list.slice(0, 11);
    let tot = 0; xiK.forEach(u => { tot += labRawOf(u, k); });
    let cap = 0; xiK.forEach(u => { const r = labRawOf(u, k); if (r > cap) cap = r; });
    arr.push({ gw: picksGw + 1 + k, v: Math.round((tot + cap) * 10) / 10 });
  }
  return arr;
}
// pure summary of the current experiment state (current vs edited 15)
function labCompute(ids, curIds, newIds, picksGw, bank, hist) {
  const u = labUniverse(ids);
  const byId = {}; u.forEach(x => byId[x.id] = x);
  const cur = curIds.map(id => byId[id]).filter(Boolean);
  const neu = newIds.map(id => byId[id]).filter(Boolean);
  const C = labTotal(cur), E = labTotal(neu);
  const edits = curIds.reduce((n, id, i) => n + (id !== newIds[i] ? 1 : 0), 0);
  const hits = Math.max(0, edits - 1) * 4;
  const costC = cur.reduce((s, x) => s + x.cost, 0), costE = neu.reduce((s, x) => s + x.cost, 0);
  const bankAfter = Math.round((bank + costC - costE) * 100) / 100;
  const realSeries = ((hist && hist.current) || []).filter(e => e && e.event && e.event <= picksGw)
    .map(e => ({ gw: e.event, v: Math.round((e.points || 0) * 10) / 10 })).sort((a, b) => a.gw - b.gw);
  return { edits, hits, costC, costE, bankAfter, bank,
    cTot: C.tot, eTot: E.tot, d0: E.tot - C.tot,
    xiCur: C.xi, xiEdit: E.xi, capIdCur: C.capId, capIdEdit: E.capId,
    c5: labSeries(cur, picksGw), e5: labSeries(neu, picksGw), realSeries, cur, neu, byId };
}
// same-position swap candidates for one slot, honouring budget & duplicates
function labCandidateList(byId, curIds, newIds, bank, slotI, limit) {
  const slotCur = byId[curIds[slotI]];
  const posL = slotCur ? slotCur.posL : 'MID';
  const chosen = new Set(newIds);
  let bankOther = bank;
  for (let j = 0; j < newIds.length; j++) {
    if (j === slotI) continue;
    const a = byId[curIds[j]], b = byId[newIds[j]];
    if (a && b) bankOther += a.cost - b.cost;
  }
  const capFunds = Math.round((bankOther + (slotCur ? slotCur.cost : 0)) * 100) / 100;
  const list = [];
  Object.keys(byId).forEach(k => {
    const c = byId[k];
    if (!c || c.posL !== posL || chosen.has(c.id)) return;
    if (c.status !== 'a') return; // only healthy, available players as swap targets
    list.push({ id: c.id, name: c.name, short: c.short, cost: c.cost, form: c.form,
      own: c.own, ep: labEpOf(c), aff: (capFunds + 1e-9) >= c.cost, status: c.status });
  });
  list.sort((a, b) => b.ep - a.ep || a.cost - b.cost || a.name.localeCompare(b.name));
  const n = (limit || 50) | 0;
  return { posL, capFunds,
    aff: list.filter(x => x.aff).slice(0, n),
    una: list.filter(x => !x.aff).slice(0, 12) };
}
// ---- DOM glue (guarded at the call site; a lab bug can never take My Team down)
function renderTeamLab(ids, squad, picksGw, bank, hist) {
  const host = $('#labPanel');
  if (!host) return;
  if (!ids || !ids.elements || !squad || !squad.length) {
    host.innerHTML = '<p class="hint" style="margin-bottom:0">Load My Team above to start experimenting.</p>';
    return;
  }
  const byId = {}; labUniverse(ids).forEach(u => byId[u.id] = u);
  const curIds = squad.map(s => s.r.element).filter(id => byId[id]);
  if (curIds.length < 15) {
    host.innerHTML = '<p class="hint" style="margin-bottom:0">Team Lab needs your full 15-man squad.</p>';
    return;
  }
  const st = { ids, byId, curIds, newIds: curIds.slice(), picksGw, bank, hist };
  const fmt = (x, sign) => { const r = Math.round(x * 10) / 10; return (sign && r > 0 ? '+' : '') + r.toFixed(1); };
  host.innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">' +
      '<span class="lab-live" title="updates on every change">● LIVE</span>' +
      '<span class="muted">swap a slot → the three charts below update instantly</span>' +
      '<button id="labReset" class="btn ghost" type="button" style="margin-left:auto">↺ Reset to my real team</button>' +
    '</div>' +
    '<div id="labRows" class="lab-grid"></div>' +
    '<div id="labSum" style="margin-top:12px"></div>' +
    '<p class="hint" style="margin-bottom:0;margin-top:10px">Same-position swaps only, so the team stays FPL-legal. ' +
    'Options you cannot afford yet are greyed — downgrade another slot first to free budget. ' +
    'Price = today\u2019s value (assume you sell at current price). Captain is the model\u2019s suggested captain, like the Best XI card. ' +
    'Nothing here is saved to FPL — it\u2019s an experiment on real data.</p>';
  $('#labReset').onclick = () => { st.newIds = st.curIds.slice(); paint(); };

  function slotOptions(i) {
    const now = byId[st.newIds[i]];
    const L = labCandidateList(byId, st.curIds, st.newIds, st.bank, i);
    const opt = (c, dis) => `<option value="${c.id}"${dis ? ' disabled' : ''} title="${esc(c.name)} · ${esc(c.short)} · form ${c.form} · ${c.own}% owned">` +
      `${esc(c.name)} (${esc(c.short)}) · £${c.cost.toFixed(1)}m · xP ${c.ep.toFixed(1)}${dis ? ' — needs more funds' : ''}</option>`;
    return '<option value="' + now.id + '">✓ Keep ' + esc(now.name) + ' · £' + now.cost.toFixed(1) + 'm</option>' +
      (L.aff.length ? '<optgroup label="⇄ Replace with… (by model xP next GW)">' + L.aff.map(c => opt(c, false)).join('') + '</optgroup>' : '') +
      (L.una.length ? '<optgroup label="🔒 Out of budget (top by xP)">' + L.una.map(c => opt(c, true)).join('') + '</optgroup>' : '');
  }

  function paint() {
    const res = labCompute(st.ids, st.curIds, st.newIds, st.picksGw, st.bank, st.hist);
    const xiIds = new Set(res.xiEdit.map(u => u.id));
    const changedAt = {}; st.curIds.forEach((id, i) => { if (id !== st.newIds[i]) changedAt[st.newIds[i]] = true; });

    // ---- slot pickers ----
    const rowsEl = $('#labRows');
    if (rowsEl) rowsEl.innerHTML = st.newIds.map((id, i) => {
      const cur = byId[st.curIds[i]], now = byId[id];
      const changed = cur.id !== now.id;
      const inXi = xiIds.has(now.id);
      return `<div class="lab-slot${changed ? ' changed' : ''}">
        <div class="lab-num">${i + 1}</div>
        <div>
          <div class="lab-headline">${posBadge(now.posL)} <b>${esc(now.name)}</b>
            <span class="team-tag">${esc(now.short)} · £${now.cost.toFixed(1)}m</span>
            ${inXi ? '<span class="lab-badge xi">START XI</span>' : '<span class="lab-badge b">BENCH</span>'}
            ${now.id === res.capIdEdit ? '<span class="lab-badge cap">👑 captain</span>' : ''}
            ${changed ? '<span class="lab-badge swap" title="was ' + esc(cur.name) + '">⇄ swapped</span>' : ''}
          </div>
          <select class="lab-sel" data-slot="${i}" title="Pick who plays this slot">${slotOptions(i)}</select>
        </div>
        <div class="lab-xp"><div class="lab-xpv">xP ${labEpOf(now).toFixed(1)}</div>
          <div class="lab-meta">${changed ? 'was: ' + esc(cur.name) : esc(now.short) + ' · form ' + now.form}</div></div>
      </div>`;
    }).join('');

    // ---- summary strip ----
    const sumC5 = res.c5.reduce((s, p) => s + p.v, 0), sumE5 = res.e5.reduce((s, p) => s + p.v, 0);
    const d5 = sumE5 - sumC5;
    const net0 = res.eTot - res.hits;
    let html = '';
    if (!res.edits) {
      html += `<div class="lab-line">Your current team (no swaps yet) projects <b>${res.cTot.toFixed(1)} pts</b> next GW ` +
        `(best XI + suggested captain) and <b>${sumC5.toFixed(1)}</b> over the next 5 GWs. Pick a replacement above to compare.</div>`;
    } else {
      const cls0 = res.d0 > 0.05 ? 'up' : res.d0 < -0.05 ? 'down' : 'muted';
      const cls5 = d5 > 0.05 ? 'up' : d5 < -0.05 ? 'down' : 'muted';
      html += `<div class="lab-line"><b>Next GW (best XI + captain):</b> ${res.cTot.toFixed(1)} → ` +
        `<b>${res.eTot.toFixed(1)}</b> <span class="${cls0}">${fmt(res.d0, true)}</span></div>`;
      html += `<div class="lab-line"><b>Next 5 GWs (chart projection):</b> ${sumC5.toFixed(1)} → ` +
        `<b>${sumE5.toFixed(1)}</b> <span class="${cls5}">${fmt(d5, true)}</span></div>`;
      html += `<div class="lab-line">Team cost £${res.costC.toFixed(1)}m → <b>£${res.costE.toFixed(1)}m</b> · ` +
        `bank after swaps <b>£${Math.max(0, res.bankAfter).toFixed(1)}m</b>${res.bankAfter < 0 ? ' <span class="down">⚠ over budget</span>' : ''}</div>`;
      if (res.hits) {
        html += `<div class="lab-line">⚠ <b>${res.edits} changes</b> = ${res.edits - 1} transfer(s) beyond your 1 free one this GW ` +
          `→ <span class="down">−${res.hits} pts</span> in real FPL; net next-GW ≈ <b>${net0.toFixed(1)}</b></div>`;
      } else {
        html += `<div class="lab-line">${res.edits} change${res.edits > 1 ? 's' : ''} fits inside your 1 free transfer this GW → no hits.</div>`;
      }
    }
    const sumEl = $('#labSum'); if (sumEl) sumEl.innerHTML = html;

    // ---- repaint the three charts for the (possibly edited) squad ----
    const rows15 = st.newIds.map(id => byId[id]).filter(Boolean);
    const order = res.xiEdit.slice();
    order.push.apply(order, rows15.filter(u => !xiIds.has(u.id)).sort((a, b) => labEpOf(b) - labEpOf(a)));
    const heat = order.map((u, idx) => {
      const pos = idx < 11 ? idx + 1 : 12 + (idx - 11);
      return { r: { element: u.id, position: pos, is_captain: u.id === res.capIdEdit },
        e: { n: u.name + (changedAt[u.id] ? ' ⇄' : '') }, pos: u.pos, ep: labEpOf(u),
        fxs: labFxsOf(u, st.picksGw) };
    });
    const xiItems = heat.filter(x => x.r.position <= 11), benchItems = heat.filter(x => x.r.position > 11);
    const momEl = $('#teamMom');
    if (momEl && typeof teamMomChart === 'function') momEl.innerHTML = teamMomChart(res.realSeries, res.c5, res.edits ? res.e5 : null);
    const momH = $('#momHint');
    if (momH) momH.textContent = res.edits
      ? 'Bars = your real weekly score. Amber dashed = your team\u2019s projection; green dashed = the EDITED team (Team Lab). Reset the lab to drop the green line.'
      : 'Bars = your real weekly score (official entry history). Dashed line = model best-XI + captain projection (next 5 GWs, labelled estimate).';
    const heatEl = $('#squadHeat');
    if (heatEl && typeof squadHeatHtml === 'function') heatEl.innerHTML = squadHeatHtml(heat, st.picksGw);
    const heatH = $('#heatHint');
    if (heatH) heatH.textContent = res.edits
      ? 'Now showing the EDITED squad (⇄ = swapped in the Team Lab). Starters on top, bench dimmed (B), captain 👑.'
      : 'Rows: your projected starters first, bench dimmed (B). Cells coloured by adjusted difficulty 1–5 — your best transfer/bench windows at a glance.';
    const posEl = $('#posStack');
    if (posEl && typeof posStackHtml === 'function') posEl.innerHTML = posStackHtml(xiItems, benchItems);
  }

  host.onchange = ev => {
    const sel = ev.target;
    if (!sel || !sel.dataset || sel.dataset.slot === undefined) return;
    const i = +sel.dataset.slot;
    if (!(i >= 0 && i < st.newIds.length)) return;
    const val = +sel.value;
    if (!byId[val]) return;
    const curId = st.newIds[i];
    if (byId[val].posL !== byId[curId].posL) return;                 // same-position swap only
    if (val !== curId && st.newIds.indexOf(val) !== -1) return;      // duplicate guard
    st.newIds[i] = val;
    paint();
  };
  paint();
}

// ============ 🛰️ MARKET PULSE (v36) ============
// "Where is the crowd going, and does our model agree?" — built ONLY from real
// data we already ship: official FPL transfer momentum + ownership for the whole
// population (players.json) and the real behaviour of the 40 tracked elite
// managers (elite.json: per-GW bought/sold/owned/captained maps + their actual
// chips). No social-media scraping: those platforms need paid keys/OAuth and a
// static host cannot hold a secret. Every number is honest about its sample size.
//
// Pure core (crowdList / crowdVerdict / crowdSellVerdict / chipTrends / eliteFlow)
// is deterministic and regression-tested; rendering is guarded at the call site.

const CHIP_LABELS = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain' };

// -------- what the WHOLE population is buying / selling this GW --------
function crowdList(players, dir, n) {
  const withM = (p) => {
    let f = null;
    try { f = (typeof forecastOf === 'function') ? forecastOf(p) : null; } catch (e) { f = null; }
    return { p, f, net: (p.t_in || 0) - (p.t_out || 0), net3: (typeof hSumP === 'function') ? hSumP(p, 3) : 0 };
  };
  const rows = (players || []).filter(p => p && p.name).map(withM)
    .sort((a, b) => dir === 'out' ? a.net - b.net : b.net - a.net);
  return rows.slice(0, n || 10);
}

// -------- does our model back the crowd's buy? (deterministic verdict) --------
function crowdVerdict(p, f) {
  const st = (p && p.status) || 'a';
  if (st !== 'a') return { tag: '⚠️ FLAG RISK', cls: 'warn', why: 'status "' + st + '" — the market may be buying a player who does not start' };
  if (!f) return { tag: '— NO MODEL', cls: 'muted', why: 'not in the model catalog' };
  const run = (typeof runAvg3Of === 'function') ? runAvg3Of(p) : 3;
  if (f.conf && f.conf.lvl === 'LOW') return { tag: '⚠️ THIN DATA', cls: 'warn', why: 'low confidence — ' + esc(f.conf.why) };
  if (run >= 3.4) return { tag: '⚠️ TOUGH RUN', cls: 'warn', why: 'next-3 adjusted difficulty ' + run.toFixed(1) + '/5 — buying the fixture too late' };
  if (f.xp >= 7) return { tag: '✅ MODEL AGREES', cls: 'ok', why: 'top-tier model xP ' + f.xp.toFixed(1) + ' with ' + Math.round((f.minutes ? f.minutes.pStart : 0) * 100) + '% start odds' };
  if (f.xp >= 5.5) return { tag: '🤝 FAIR VALUE', cls: 'mid', why: 'solid ' + f.xp.toFixed(1) + ' xP — a reasonable squad piece, not a standout' };
  return { tag: '⚠️ CROWD AHEAD', cls: 'warn', why: 'model xP only ' + f.xp.toFixed(1) + ' — the market is ahead of the maths' };
}
// -------- and the crowd's sell? --------
function crowdSellVerdict(p, f) {
  if (!f) return { tag: '— NO MODEL', cls: 'muted', why: 'not in the model catalog' };
  if (f.conf && f.conf.lvl === 'LOW') return { tag: '✅ AGREE', cls: 'ok', why: 'low confidence — ' + esc(f.conf.why) };
  if (f.xp >= 6.5) return { tag: '⚠️ POSSIBLE MISTAKE', cls: 'warn', why: 'still projects ' + f.xp.toFixed(1) + ' xP — selling a good asset' };
  if (f.xp >= 4.5) return { tag: '🤝 FAIR', cls: 'mid', why: f.xp.toFixed(1) + ' xP — fine to move on' };
  return { tag: '✅ AGREE', cls: 'ok', why: 'only ' + f.xp.toFixed(1) + ' xP — the crowd is right to move on' };
}

// -------- which chip is being used most, and by how many (real elite cohort) --------
function chipTrends(elite, ownChips, rivalChips, hasTeam) {
  const es = (elite && elite.elites) || [];
  const counts = {}, firstGw = {}, usedBy = {};
  Object.keys(CHIP_LABELS).forEach(k => { counts[k] = 0; usedBy[k] = []; });
  es.forEach(e => {
    const ch = (e && e.chips) || {};
    Object.keys(ch).forEach(gw => {
      const k = ch[gw];
      if (counts[k] == null) { counts[k] = 0; usedBy[k] = []; }
      counts[k]++;
      usedBy[k].push(e.entry);
      if (firstGw[k] == null || +gw < firstGw[k]) firstGw[k] = +gw;
    });
  });
  const sample = es.length;
  const rows = Object.keys(CHIP_LABELS).map(k => ({
    key: k, label: CHIP_LABELS[k], used: counts[k] || 0, hold: sample - (counts[k] || 0),
    pct: sample ? Math.round(100 * (counts[k] || 0) / sample) : 0, firstGw: firstGw[k] == null ? null : firstGw[k],
  })).sort((a, b) => b.used - a.used);
  const own = (ownChips || []).map(k => CHIP_LABELS[k] || k);
  const ownHold = Object.keys(CHIP_LABELS).map(k => CHIP_LABELS[k]).filter(l => own.indexOf(l) === -1);
  return { sample, rows, top: rows[0] || null, own, ownHold, haveTeam: !!hasTeam,
    rival: (rivalChips || []).map(k => CHIP_LABELS[k] || k) };
}

// -------- what the tracked elites actually bought / sold / captained at a GW --------
function eliteFlow(elite, gw, players, n) {
  const g = ((elite && elite.gw) || {})[String(gw)] || null;
  const byId = {};
  (players || []).forEach(p => { byId[p.id] = p; });
  const top = (map, k) => Object.keys(map || {})
    .map(id => ({ p: byId[+id] || null, id: +id, n: map[id] }))
    .filter(x => x.p && x.n > 0)
    .sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name))
    .slice(0, k || 8);
  if (!g) return { gw, n: 0, bought: [], sold: [], captained: [], owned: [] };
  return {
    gw, n: g.n || (elite && elite.meta && elite.meta.cohort) || 0,
    bought: top(g.bought, n), sold: top(g.sold, n),
    captained: top(g.cap, n), owned: top(g.own, n),   // same cap as the other lists
  };
}

// -------- HTML builders --------
function crowdRowHtml(r, dir) {
  const p = r.p, f = r.f;
  const v = dir === 'out' ? crowdSellVerdict(p, f) : crowdVerdict(p, f);
  const nm = p.name, team = p.team || '';
  const netTxt = (r.net >= 0 ? '+' : '−') + fmtK(Math.abs(r.net));
  const xp = f ? f.xp.toFixed(1) : '—';
  const p6 = f ? f.p6 + '%' : '—';
  return `<div class="mp-row">
    <div class="mp-top">
      ${posBadge(p.pos)} <b>${esc(nm)}</b>
      <span class="team-tag">${esc(team)} · £${(+p.cost || 0).toFixed(1)}m · ${p.own}% owned</span>
      <span class="mp-net ${r.net >= 0 ? 'up' : 'down'}">${netTxt}</span>
    </div>
    <div class="mp-mid">
      <span class="mp-chip ${v.cls}">${v.tag}</span>
      <span class="mp-why">${v.why}</span>
    </div>
    <div class="mp-stats">
      <span>model xP <b>${xp}</b></span><span>P(≥6) <b>${p6}</b></span>
      <span>3-GW xP <b>${r.net3.toFixed(1)}</b></span>
      <span>${f && f.conf ? 'conf <b>' + f.conf.lvl + '</b>' : ''}</span>
    </div>
  </div>`;
}

function crowdModelHtml(buys, sells) {
  if ((!buys || !buys.length) && (!sells || !sells.length)) return '<p class="hint">No transfer data yet.</p>';
  return `<div class="mp-cols">
    <div><h4 class="mp-h up">▲ The crowd is buying — and our model says…</h4>${(buys || []).map(r => crowdRowHtml(r, 'in')).join('')}</div>
    <div><h4 class="mp-h down">▼ The crowd is selling — and our model says…</h4>${(sells || []).map(r => crowdRowHtml(r, 'out')).join('')}</div>
  </div>`;
}

function chipTrendsHtml(ct) {
  if (!ct || !ct.sample) return '<p class="hint">Chip trends need the elite dataset.</p>';
  const rows = ct.rows.map(r => `<div class="mp-chip-row">
      <div class="mp-chip-name">${esc(r.label)}</div>
      <div class="mp-bar"><div class="mp-bar-fill" style="width:${Math.max(2, r.pct)}%"></div></div>
      <div class="mp-chip-num"><b>${r.used}</b>/${ct.sample} <span class="muted">(${r.pct}%)</span></div>
      <div class="mp-chip-meta">${r.firstGw ? 'first used GW' + r.firstGw : 'unused'} · ${r.hold} still holding</div>
    </div>`).join('');
  const top = ct.top;
  return `<div class="mp-headline">Most-used chip among the <b>${ct.sample}</b> tracked elite managers:
      <span class="mp-chip ok">🃏 ${esc(top.label)}</span> — used by <b>${top.used} of ${ct.sample}</b> (${top.pct}%).</div>
    ${rows}
    <p class="hint" style="margin:10px 0 0">Sample = ${ct.sample} real top-ranked managers we track (not the whole ${((DATA.fplmeta||{}).total_players ? (DATA.fplmeta.total_players/1e6).toFixed(1)+'m' : '')} population — FPL publishes no global chip counter).${!ct.haveTeam ? ' <b>Load your team in My Team</b> to see your own chips next to this.' : (ct.own && ct.own.length ? ' Your chips used: <b>' + ct.own.map(esc).join(', ') + '</b>.' : ' You have not used any chips yet.') + (ct.ownHold && ct.ownHold.length ? ' You still hold: <b>' + ct.ownHold.map(esc).join(', ') + '</b>' + (ct.ownHold.length >= 3 ? ' — the crowd has mostly spent theirs, so holding is now a real edge.' : '.') : '')}${ct.rival && ct.rival.length ? ' Main rival has used: ' + ct.rival.map(esc).join(', ') + '.' : ''}</p>`;
}

function eliteFlowHtml(ef) {
  if (!ef || !ef.n) return '<p class="hint">Elite flow needs a completed gameweek.</p>';
  const list = (arr) => arr.length
    ? arr.map(x => `<div class="mp-elite-row">
        ${posBadge(x.p.pos)} <b>${esc(x.p.name)}</b> <span class="team-tag">${esc(x.p.team)} · £${(+x.p.cost || 0).toFixed(1)}m</span>
        <span class="mp-count">${x.n}/${ef.n}</span></div>`).join('')
    : '<p class="hint" style="margin:0">none</p>';
  return `<div class="mp-cols">
    <div><h4 class="mp-h up">▲ What the elites bought (GW${ef.gw})</h4>${list(ef.bought)}</div>
    <div><h4 class="mp-h down">▼ What the elites sold (GW${ef.gw})</h4>${list(ef.sold)}</div>
    <div><h4 class="mp-h">👑 Elite captains (GW${ef.gw})</h4>${list(ef.captained.slice(0, 6))}</div>
    <div><h4 class="mp-h">📦 Most-owned by elites (GW${ef.gw})</h4>${list(ef.owned.slice(0, 6))}</div>
  </div>`;
}

// -------- render (guarded at the call site) --------
function renderMarketPulse() {
  const host = $('#crowdModel');
  if (!host) return;
  const buys = crowdList(DATA.players, 'in', 8);
  const sells = crowdList(DATA.players, 'out', 6);
  host.innerHTML = crowdModelHtml(buys, sells);

  const chipHost = $('#chipTrends');
  if (chipHost) {
    const ctx = window.TEAMCTX || null;
    const own = ctx && ctx.usedChips ? ctx.usedChips : [];
    const rival = (typeof ML !== 'undefined' && ML && ML.ready && ML.prim && ML.prim.chips) ? ML.prim.chips : [];
    chipHost.innerHTML = chipTrendsHtml(chipTrends(DATA.elite, own, rival, !!ctx));
  }
  const flowHost = $('#eliteFlow');
  if (flowHost) {
    const gw = +(((DATA.elite || {}).meta || {}).latest_complete || DATA.meta.latest_gw || 0);
    flowHost.innerHTML = eliteFlowHtml(eliteFlow(DATA.elite, gw, DATA.players, 8));
  }
}

// ============ 🛰️ VISUALS (v37): crowd map, elite-gap bars, chip timeline, bargain map ============
// All charts are pure inline SVG built from data the app already loads — no new
// network calls, no libraries. Every chart states its sample + that values are
// model estimates. Layout functions return plain data so tests can assert the
// semantics (which player lands in which quadrant) without parsing SVG.

// ---------- A. Crowd vs Model quadrant map ----------
function crowdMapLayout(players) {
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
  const rows = [];
  (players || []).forEach(p => {
    if (!p || !p.name) return;
    let f = null;
    try { f = (typeof forecastOf === 'function') ? forecastOf(p) : null; } catch (e) { f = null; }
    if (!f || f.xp == null || !isFinite(f.xp)) return;
    const net = (p.t_in || 0) - (p.t_out || 0);
    if ((p.own == null || p.own < 2.5) && Math.abs(net) < 40) return;   // only meaningful players
    rows.push({ p, net, xp: f.xp });
  });
  if (rows.length < 4) return { dots: [], medNet: 0, xThr: 5.5, xmax: 200, ymax: 8 };
  const medNet = med(rows.map(r => r.net));
  const xThr = 5.5;   // the SAME bar the verdict rows use: >=5.5 model at least rates him, <5.5 = "crowd ahead" zone
  const absNet = rows.map(r => Math.abs(r.net)).sort((a, b) => a - b);
  let xmax = Math.max(200, Math.min(800, Math.ceil((absNet[Math.floor(absNet.length * .97)] || 400) / 50) * 50));
  const ymax = Math.max(8, Math.ceil((rows.map(r => r.xp).sort((a, b) => a - b)[Math.floor(rows.length * .97)] || 8) * 1.05));
  const dots = rows.map(r => {
    const q = (r.net >= medNet && r.xp >= xThr) ? 'buy' : (r.net >= medNet) ? 'fomo' : (r.xp >= xThr) ? 'radar' : 'fade';
    return { p: r.p, net: r.net, xp: r.xp, q, own: r.p.own || 0 };
  });
  return { dots, medNet, xThr, xmax, ymax };
}

function crowdMapSVG(players) {
  const L = crowdMapLayout(players);
  if (!L.dots.length) return '<p class="hint">Not enough data for the market map yet.</p>';
  const W = 640, H = 380, x0 = 46, x1 = 626, y0 = 26, y1 = 336;
  const sx = (net) => x0 + (Math.max(-L.xmax, Math.min(L.xmax, net)) + L.xmax) / (2 * L.xmax) * (x1 - x0);
  const sy = (xp) => y1 - Math.max(0, Math.min(L.ymax, xp)) / L.ymax * (y1 - y0);
  const fmtK = (n) => (n >= 0 ? '+' : '−') + Math.round(Math.abs(n) / 1000) + 'k';
  const QC = { buy: '#00ff85', fomo: '#ffc94d', radar: '#4dc3ff', fade: '#b7a4da' };
  let g = '';
  // grid + ticks
  for (let t = 0; t <= 4; t++) {
    const gx = x0 + (x1 - x0) * t / 4;
    g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y1}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${gx}" y="${y1 + 16}" text-anchor="middle" font-size="10" fill="#b7a4da">${fmtK(-L.xmax + 2 * L.xmax * t / 4)}</text>`;
  }
  const ystep = Math.max(2, Math.round(L.ymax / 5));
  for (let v = 0; v <= L.ymax; v += ystep) {
    const gy = sy(v);
    g += `<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#b7a4da">${v}</text>`;
  }
  // quadrant medians
  const mx = sx(L.medNet), my = sy(L.xThr);
  g += `<line x1="${mx}" y1="${y0}" x2="${mx}" y2="${y1}" stroke="rgba(177,140,255,.5)" stroke-dasharray="5 4"/>` +
    `<line x1="${x0}" y1="${my}" x2="${x1}" y2="${my}" stroke="rgba(0,255,133,.45)" stroke-dasharray="5 4"/>` +
    `<text x="${x0 + 4}" y="${my - 4}" font-size="9" fill="#00ff85" opacity=".8">model "rates him" line — 5.5 xP, the same bar as the verdict rows</text>`;
  // corner labels
  const corners = [
    ['MODEL AHEAD ↑ / crowd selling', x0 + 8, y0 + 14, 'radar'], ['CROWD + MODEL AGREE', x1 - 8, y0 + 14, 'buy'],
    ['NOBODY WANTS / model doubts', x0 + 8, y1 - 8, 'fade'], ['CROWD AHEAD / model doubts', x1 - 8, y1 - 8, 'fomo']];
  corners.forEach(c => { g += `<text x="${c[1]}" y="${c[2]}" text-anchor="${c[1] > (x0 + x1) / 2 ? 'end' : 'start'}" font-size="9.5" font-weight="700" fill="${QC[c[3]]}" opacity=".75">${c[0]}</text>`; });
  // dots (biggest crowd moves + model favourites first so labels sit on top)
  const order = L.dots.slice().sort((a, b) => (Math.abs(b.net) + b.xp) - (Math.abs(a.net) + a.xp));
  const labelSet = new Set(order.slice(0, 12).map(d => d.p.name));
  order.forEach(d => {
    const cx = sx(d.net), cy = sy(d.xp), r = d.own >= 20 ? 5.5 : d.own >= 8 ? 4.5 : 3.5;
    g += `<g><title>${d.p.name} (${d.p.pos}, ${d.p.team}) — net ${fmtK(d.net)}, ${d.own.toFixed(1)}% owned, model xP ${d.xp.toFixed(1)}</title>` +
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${QC[d.q]}" opacity=".85"/></g>`;
  });
  // labels for the headliners (stagger to reduce overlap)
  order.slice(0, 12).forEach((d, i) => {
    const cx = sx(d.net), cy = sy(d.xp);
    const up = i % 2 === 0;
    g += `<text x="${(cx + (cx > x1 - 90 ? -8 : 8)).toFixed(1)}" y="${(cy + (up ? -8 : 13)).toFixed(1)}" text-anchor="${cx > x1 - 90 ? 'end' : 'start'}" font-size="10" font-weight="700" fill="#efeafd" paint-order="stroke" stroke="rgba(18,10,40,.9)" stroke-width="3">${d.p.name.split(' ').slice(-1)[0]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>Market map: crowd transfers (left-right) vs model expected points (up-down). Model estimate.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">↑ model xP (next GW, estimate) · → net transfers this GW (clamped ±${L.xmax / 1000}k) · dot size = ownership</text>${g}` +
    `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8d7bb5">dashed lines = medians of the ${L.dots.length} tracked players — every dot is a model estimate, not a promise</text></svg>`;
}

// ---------- B. Smart-money gap: elite ownership vs crowd ownership ----------
function eliteGapData(elite, players, n) {
  if (!elite || !elite.gw || !elite.elites || !elite.elites.length) return { rows: [], n: 0, gw: 0 };
  const gw = +((elite.meta || {}).latest_complete || 0);
  const g = elite.gw[String(gw)];
  if (!g || !g.own) return { rows: [], n: 0, gw };
  const N = elite.elites.length;
  const byId = {}; (players || []).forEach(p => { if (p && p.id != null) byId[p.id] = p; });
  const cand = new Set();
  Object.entries(g.own).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([id]) => cand.add(+id));
  Object.entries(g.bought || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id]) => cand.add(+id));
  Object.entries(g.sold || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id]) => cand.add(+id));
  const rows = [];
  cand.forEach(id => {
    const p = byId[id];
    if (!p) return;
    const ePct = (g.own[id] || 0) / N * 100;
    const cPct = (p.own != null ? p.own : 0);
    rows.push({ p, elitePct: ePct, crowdPct: cPct, delta: ePct - cPct, bought: (g.bought || {})[id] || 0, sold: (g.sold || {})[id] || 0 });
  });
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { rows: rows.slice(0, n || 10), n: N, gw };
}

function eliteGapHtml(data) {
  if (!data || !data.rows.length) return '<p class="hint">No elite ownership data yet.</p>';
  const rows = data.rows.map(r => {
    const tag = r.delta >= 0 ? 'elites ahead' : 'crowd ahead';
    const cls = r.delta >= 0 ? 'ok' : 'warn';
    return `<div class="vg-gap-row"><div class="vg-gap-name"><b>${esc(r.p.name)}</b> <span class="muted">${r.p.pos} · ${esc(r.p.team)} · £${(r.p.cost || 0).toFixed(1)}m</span>` +
      ` <span class="mp-chip ${cls}">${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(0)}pp ${tag}</span></div>` +
      `<div class="vg-gap-bars"><span class="vg-lab">crowd</span><div class="mp-bar"><div class="mp-bar-fill" style="width:${Math.min(100, r.crowdPct).toFixed(1)}%"></div></div><span class="vg-num">${r.crowdPct.toFixed(0)}%</span>` +
      `<span class="vg-lab">elite</span><div class="mp-bar"><div class="mp-bar-fill alt" style="width:${Math.min(100, r.elitePct).toFixed(1)}%"></div></div><span class="vg-num">${r.elitePct.toFixed(0)}%</span></div></div>`;
  }).join('');
  return `<p class="hint" style="margin:2px 0 8px">Who do the <b>${data.n} tracked elites</b> hold vs the whole population (GW${data.gw})? Biggest gaps first — “elites ahead” = they back a player the crowd hasn't found yet.</p>${rows}`;
}

// ---------- C. Chip timeline: when the 40 elites spent each chip ----------
function chipTimelineData(elite) {
  if (!elite || !elite.elites || !elite.elites.length) return { chips: [], lastGw: 0, n: 0 };
  const lastGw = Math.max(1, +((elite.meta || {}).latest_complete || 1));
  const N = elite.elites.length;
  const names = { bboost: 'Bench Boost', '3xc': 'Triple Captain', freehit: 'Free Hit', wildcard: 'Wildcard' };
  const per = {}; Object.keys(names).forEach(k => per[k] = {});
  const used = {}; Object.keys(names).forEach(k => used[k] = 0);
  elite.elites.forEach(e => {
    Object.entries(e.chips || {}).forEach(([gw, k]) => {
      if (!names[k]) return;
      per[k][gw] = (per[k][gw] || 0) + 1;
      used[k]++;
    });
  });
  const chips = Object.keys(names).map(k => ({ key: k, label: names[k], used: used[k], hold: N - used[k], marks: per[k] }));
  chips.sort((a, b) => b.used - a.used);
  return { chips, lastGw, n: N };
}

function chipTimelineSVG(elite) {
  const T = chipTimelineData(elite);
  if (!T.chips.length) return '<p class="hint">No chip history yet.</p>';
  const COL = { bboost: '#4dc3ff', '3xc': '#ffc94d', freehit: '#b18cff', wildcard: '#ff5575' };
  const slots = Math.max(T.lastGw, 5);
  const laneL = 118, x0 = 126, x1 = 470, holdX = 480, W = 640;
  const laneH = 34, H = 30 + T.chips.length * laneH + 26;
  const cx = (gw) => x0 + (x1 - x0) * (gw - 0.5) / slots;
  let g = '';
  for (let gw = 1; gw <= slots; gw++) {
    const gx = cx(gw);
    g += `<line x1="${gx}" y1="26" x2="${gx}" y2="${H - 24}" stroke="rgba(255,255,255,.06)"/>` +
      `<text x="${gx}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#b7a4da">GW${gw}${gw > T.lastGw ? ' ·' : ''}</text>`;
  }
  T.chips.forEach((c, i) => {
    const ly = 26 + i * laneH + laneH / 2;
    g += `<text x="${laneL}" y="${ly + 4}" text-anchor="end" font-size="11" font-weight="700" fill="#efeafd">${c.label}</text>` +
      `<line x1="${x0}" y1="${ly}" x2="${x1}" y2="${ly}" stroke="rgba(255,255,255,.14)"/>`;
    Object.entries(c.marks).forEach(([gw, cnt]) => {
      const r = 4.5 + 8 * (cnt / T.n);
      g += `<g><title>${cnt} of ${T.n} elites played ${c.label} in GW${gw}</title>` +
        `<circle cx="${cx(+gw).toFixed(1)}" cy="${ly}" r="${r.toFixed(1)}" fill="${COL[c.key]}" opacity=".9"/></g>` +
        `<text x="${cx(+gw).toFixed(1)}" y="${ly - r - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#efeafd">${cnt}</text>`;
    });
    g += `<text x="${holdX}" y="${ly + 4}" font-size="10.5" fill="#b7a4da"><tspan font-weight="700" fill="${c.hold > 0 ? '#00ff85' : '#b7a4da'}">${c.hold}</tspan>/${T.n} still hold</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>When the ${T.n} tracked elite managers played each chip, and how many are still holding.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">circle size = how many of the ${T.n} tracked elites used the chip that week</text>${g}</svg>`;
}

// ---------- D. Bargain map: price vs model xP, with the fair-value curve ----------
function bargainLayout(players) {
  const pts = [];
  (players || []).forEach(p => {
    if (!p || !p.name || p.cost == null) return;
    let f = null;
    try { f = (typeof forecastOf === 'function') ? forecastOf(p) : null; } catch (e) { f = null; }
    if (!f || f.xp == null || !isFinite(f.xp)) return;
    if ((p.own == null || p.own < 2) && f.xp < 3.5) return;
    pts.push({ p, price: p.cost, xp: f.xp });
  });
  if (pts.length < 10) return { pts: [], curve: [], pmin: 3.5, pmax: 15, ymax: 8 };
  const pmin = Math.floor(Math.min.apply(null, pts.map(r => r.price)) * 2) / 2;
  const pmax = Math.ceil(Math.max.apply(null, pts.map(r => r.price)) * 2) / 2;
  const ymax = Math.max(8, Math.ceil(pts.map(r => r.xp).sort((a, b) => a - b)[Math.floor(pts.length * .97)] * 1.05));
  // fair value = median model xP per £0.5m bucket (needs >= 4 players in a bucket to be honest)
  const buckets = {};
  pts.forEach(r => { const b = Math.floor(r.price * 2) / 2; (buckets[b] = buckets[b] || []).push(r.xp); });
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const curve = Object.keys(buckets).map(Number).sort((a, b) => a - b)
    .filter(b => buckets[b].length >= 4).map(b => ({ price: b, med: med(buckets[b]), n: buckets[b].length }));
  pts.forEach(r => {
    const b = Math.floor(r.price * 2) / 2;
    const c = curve.find(cv => cv.price === b);
    r.bucketMed = c ? c.med : null;
    r.above = c ? r.xp > c.med : null;
  });
  return { pts, curve, pmin, pmax, ymax };
}

function bargainMapSVG(players) {
  const L = bargainLayout(players);
  if (!L.pts.length) return '<p class="hint">Not enough data for the bargain map yet.</p>';
  const W = 640, H = 380, x0 = 46, x1 = 626, y0 = 26, y1 = 336;
  const sx = (pr) => x0 + (pr - L.pmin) / (L.pmax - L.pmin || 1) * (x1 - x0);
  const sy = (xp) => y1 - Math.max(0, Math.min(L.ymax, xp)) / L.ymax * (y1 - y0);
  let g = '';
  const xstep = Math.max(1, Math.round((L.pmax - 3.5) / 12));
  for (let v = L.pmin; v <= L.pmax + 1e-9; v += xstep) {
    const gx = sx(v);
    g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y1}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${gx}" y="${y1 + 16}" text-anchor="middle" font-size="10" fill="#b7a4da">£${v % 1 ? v.toFixed(1) : v}m</text>`;
  }
  const ystep = Math.max(2, Math.round(L.ymax / 5));
  for (let v = 0; v <= L.ymax; v += ystep) {
    const gy = sy(v);
    g += `<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#b7a4da">${v}</text>`;
  }
  // fair-value curve (median model xP per price bucket)
  if (L.curve.length >= 2) {
    const path = L.curve.map(c => `${sx(c.price + 0.25).toFixed(1)},${sy(c.med).toFixed(1)}`).join(' ');
    g += `<polyline points="${path}" fill="none" stroke="#b18cff" stroke-width="2" stroke-dasharray="7 5" opacity=".9"/>`;
  }
  // dots
  const sorted = L.pts.slice().sort((a, b) => (b.bucketMed != null && a.bucketMed != null ? (b.xp - b.bucketMed) - (a.xp - a.bucketMed) : 0));
  L.pts.forEach(r => {
    const col = r.above == null ? '#b7a4da' : r.above ? '#00ff85' : '#ff5575';
    g += `<g><title>${r.p.name} (${r.p.pos}, ${esc(r.p.team)}) — £${r.price.toFixed(1)}m, model xP ${r.xp.toFixed(1)}${r.bucketMed != null ? ' vs £-typical ' + r.bucketMed.toFixed(1) : ''}</title>` +
      `<circle cx="${sx(r.price).toFixed(1)}" cy="${sy(r.xp).toFixed(1)}" r="3.5" fill="${col}" opacity="${r.above == null ? .3 : .75}"/></g>`;
  });
  // label the biggest bargains
  sorted.slice(0, 8).forEach((r, i) => {
    if (r.bucketMed == null || !r.above) return;
    const cx = sx(r.price), cy = sy(r.xp), up = i % 2 === 0;
    g += `<text x="${(cx + 7).toFixed(1)}" y="${(cy + (up ? -7 : 13)).toFixed(1)}" font-size="10" font-weight="700" fill="#efeafd" paint-order="stroke" stroke="rgba(18,10,40,.9)" stroke-width="3">${r.p.name.split(' ').slice(-1)[0]} +${(r.xp - r.bucketMed).toFixed(1)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>Bargain map: price vs model expected points. Dots above the curve are underpriced for what the model expects.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">↑ model xP (next GW, estimate) · → price · <tspan fill="#00ff85">green = above the fair-value curve</tspan> · <tspan fill="#ff5575">red = priced above their model xP</tspan></text>${g}` +
    `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8d7bb5">dashed violet curve = median model xP at each £0.5m price (only buckets with 4+ players) — ${L.pts.length} players, all model estimates</text></svg>`;
}

// ---------- renderer: fills the four containers if present ----------
function renderVisuals() {
  const mapHost = $('#mpMap');
  if (mapHost) { try { mapHost.innerHTML = crowdMapSVG(DATA.players); } catch (e) { mapHost.innerHTML = '<p class="hint">Market map unavailable.</p>'; } }
  const gapHost = $('#eliteGap');
  if (gapHost) { try { gapHost.innerHTML = eliteGapHtml(eliteGapData(DATA.elite, DATA.players, 10)); } catch (e) { gapHost.innerHTML = '<p class="hint">Elite gap unavailable.</p>'; } }
  const tlHost = $('#chipTimeline');
  if (tlHost) { try { tlHost.innerHTML = chipTimelineSVG(DATA.elite); } catch (e) { tlHost.innerHTML = '<p class="hint">Chip timeline unavailable.</p>'; } }
  const bmHost = $('#bargainMap');
  if (bmHost) { try { bmHost.innerHTML = bargainMapSVG(DATA.players); } catch (e) { bmHost.innerHTML = '<p class="hint">Bargain map unavailable.</p>'; } }
}

function renderLeague() {
  let html = `<tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr>`;
  DATA.league.forEach((t, i) => {
    const zone = i < 4 ? 'border-left:3px solid var(--green)' : i >= 17 ? 'border-left:3px solid var(--red)' : '';
    html += `<tr style="${zone}"><td>${i+1}</td><td><b>${esc(t.team)}</b></td>
      <td class="num">${t.P}</td><td class="num ${t.GD>0?'up':t.GD<0?'down':''}">${t.GD>0?'+':''}${t.GD}</td>
      <td class="num"><b>${t.Pts}</b></td></tr>`;
  });
  $('#leagueTable').innerHTML = html;
}

function renderTopScorers() {
  let html = `<tr><th></th><th>Player</th><th class="num">Pts</th><th class="num">Own%</th><th class="num">£</th></tr>`;
  DATA.players.slice(0, 12).forEach((p, i) => {
    html += `<tr><td>${posBadge(p.pos)}</td><td><b>${esc(p.name)}</b> <span class="team-tag">${p.team}</span></td>
      <td class="num pts">${p.pts}</td><td class="num">${p.own}</td><td class="num">${p.cost}</td></tr>`;
  });
  $('#topScorers').innerHTML = html;
}

function renderResults() {
  $('#resultsGW').textContent = `(GW1–${DATA.meta.latest_gw}, xG shown)`;
  $('#resultsList').innerHTML = DATA.results.slice().reverse().map(r => `
    <div class="result-row">
      <span class="gw-tag">GW${r.gw}</span>
      <span>${r.home}</span><span class="score">${r.hs}–${r.as_}</span><span>${r.away}</span>
      ${r.hxg != null ? `<span class="xg">xG ${r.hxg}–${r.axg}</span>` : ''}
    </div>`).join('');
}

function sigCard(item, i, cls) {
  const p = item.p;
  return `<div class="sig-card ${cls}">
    <div class="rank">${i+1}</div>
    <div class="sig-info">
      <div class="sig-name">${esc(p.name)} ${posBadge(p.pos)} <span class="team-tag">${p.team} · £${p.cost}m · ${p.own}% owned</span></div>
      <div class="sig-reasons">${item.reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('')}</div>
    </div>
    <div class="sig-pts"><div class="pts">${p.pts}</div><div class="sig-meta">pts</div></div>
  </div>`;
}

function renderRadar() {
  $('#buyList').innerHTML = DATA.radar.buys.map((b, i) => sigCard(b, i, '')).join('') || '<p class="hint">No strong signals yet.</p>';
  $('#sellList').innerHTML = DATA.radar.sells.map((s, i) => sigCard(s, i, 'sell')).join('') || '<p class="hint">No strong signals yet.</p>';

  const rows = (list) => `<tr><th></th><th>Player</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num">£Δ</th></tr>` +
    list.map(p => `<tr><td>${posBadge(p.pos)}</td><td><b>${esc(p.name)}</b> <span class="team-tag">${p.team}</span></td>
      <td class="num up">${fmtK(p.t_in)}</td><td class="num down">${fmtK(p.t_out)}</td>
      <td class="num ${p.t_in-p.t_out>=0?'up':'down'}">${p.t_in-p.t_out>=0?'+':''}${fmtK(p.t_in-p.t_out)}</td>
      <td class="num ${p.price_chg>=0?'up':'down'}">${p.price_chg>0?'+':''}${p.price_chg}</td></tr>`).join('');
  $('#mostIn').innerHTML = rows(DATA.radar.most_in);
  $('#mostOut').innerHTML = rows(DATA.radar.most_out);
}

const PCOLS = [
  { k: 'name', l: 'Player' }, { k: 'pos', l: 'Pos' }, { k: 'team', l: 'Team' },
  { k: 'pts', l: 'Pts', n: 1 }, { k: 'ep', l: 'GW', n: 1 }, { k: 'mins', l: 'Min', n: 1 },
  { k: 'g', l: 'G', n: 1 }, { k: 'a', l: 'A', n: 1 }, { k: 'xg', l: 'xG', n: 1 },
  { k: 'xg_diff', l: 'G−xG', n: 1 }, { k: 'chances', l: 'Ch', n: 1 }, { k: 'cbit', l: 'CBIT', n: 1 },
  { k: 'own', l: 'Own%', n: 1 }, { k: 'cost', l: '£', n: 1 }, { k: 'form', l: 'Form', n: 1 }, { k: 'spark', l: 'Trend' },
];
let sortKey = 'pts', sortDir = -1, filterPos = '';

function renderPlayers() {
  const q = $('#search').value.trim().toLowerCase();
  const min90 = $('#min90').checked;
  let rows = DATA.players.filter(p =>
    (!filterPos || p.pos === filterPos) &&
    (!q || p.name.toLowerCase().includes(q)) &&
    (!min90 || p.mins >= 90));
  rows.sort((a, b) => sortDir * ((a[sortKey] ?? -1) > (b[sortKey] ?? -1) ? 1 : -1));
  rows = rows.slice(0, 250);
  $('#playerCount').textContent = `${rows.length} shown`;

  let html = '<tr>' + PCOLS.map(c =>
    `<th class="sortable ${c.n ? 'num' : ''}" data-k="${c.k}">${c.l}${sortKey === c.k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('') + '</tr>';
  rows.forEach(p => {
    const d = p.xg_diff;
    html += `<tr>
      <td><b>${esc(p.name)}</b>${p.status !== 'a' ? ' <span title="' + esc(p.news) + '">⚠️</span>' : ''}</td>
      <td>${posBadge(p.pos)}</td><td class="team-tag">${p.team}</td>
      <td class="num pts">${p.pts}</td><td class="num">${p.ep}</td><td class="num">${p.mins}</td>
      <td class="num">${p.g}</td><td class="num">${p.a}</td><td class="num">${p.xg}</td>
      <td class="num ${d > 0.3 ? 'up' : d < -0.3 ? 'down' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}</td>
      <td class="num">${p.chances}</td><td class="num">${p.cbit}</td>
      <td class="num">${p.own}</td><td class="num">${p.cost}</td><td class="num">${p.form}</td><td>${sparkSVG(p.id, 90, 26)}</td></tr>`;
  });
  $('#playerTable').innerHTML = html;
  $$('#playerTable th.sortable').forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
    renderPlayers();
  });
}

// ============ ⚔️ OPPONENT-STRENGTH MODEL (audit roadmap #11) ============
// Real FDR: instead of trusting the coarse 1-5 official difficulty alone, this
// derives each team's true attacking & defensive strength from REAL GW1-3
// results (official xG for/against in DATA.results, ~30 matches). Ratings are
// shrunken toward the league mean because 3 matches is a small sample — the
// model is honest that it grows stronger every gameweek. Two lenses:
//   ATTACKERS  face the opponent's DEFENCE  (xGA per match — leakier = easier)
//   DEFENDERS  face the opponent's ATTACK   (xG per match — stronger = harder)
function osmMemo() { if (!window.OSM) window.OSM = {}; return window.OSM; }
function osmBuild() {
  const mem = osmMemo();
  if (mem.rows) return mem.rows;
  const agg = {};
  (DATA.results || []).forEach(m => {
    [['home', m.hxg, m.axg], ['away', m.axg, m.hxg]].forEach(([side, xgf, xga]) => {
      const t = m[side]; if (!t) return;
      const o = agg[t] = agg[t] || { n: 0, xgf: 0, xga: 0 };
      o.n++; o.xgf += xgf || 0; o.xga += xga || 0;
    });
  });
  const names = Object.keys(agg);
  if (!names.length) { mem.rows = []; return mem.rows; }
  const sum = (k) => names.reduce((a, t) => a + (agg[t][k] / agg[t].n), 0);
  const meanXgf = sum('xgf') / names.length, meanXga = sum('xga') / names.length;
  const rows = names.map(t => {
    const o = agg[t], w = o.n / (o.n + 2); // shrinkage: 3 GWs -> 60% real, 40% league
    const att = w * (o.xgf / o.n) + (1 - w) * meanXgf;
    const xga = w * (o.xga / o.n) + (1 - w) * meanXga;
    const aM = att / meanXgf, leak = xga / meanXga;
    const atk = aM >= 1.5 ? 'elite attack' : aM >= 1.15 ? 'strong attack' : aM >= 0.85 ? 'mid attack' : 'weak attack';
    const def = leak <= 0.75 ? 'elite defence' : leak <= 1 ? 'solid defence' : leak <= 1.25 ? 'shaky defence' : 'leaky defence';
    return { short: t, n: o.n, att: Math.round(att * 100) / 100, xga: Math.round(xga * 100) / 100,
      atk, def, leak: Math.round(leak * 100) / 100, aM: Math.round(aM * 100) / 100 };
  });
  rows.sort((a, b) => b.att - a.att);
  rows.forEach((r, i) => { r.atkRank = i + 1; });
  rows.slice().sort((a, b) => a.xga - b.xga).forEach((r, i) => { r.defRank = i + 1; });
  mem.rows = rows; mem.meanXgf = meanXgf; mem.meanXga = meanXga;
  return rows;
}
function osmByShort() {
  const mem = osmMemo(); if (mem.map) return mem.map;
  const m = {}; osmBuild().forEach(r => { m[r.short] = r; }); mem.map = m; return m;
}
function osmOppLens(oppShort, pos) {
  const r = osmByShort()[oppShort];
  if (!r) return '';
  const isDef = pos === 'DEF' || pos === 'GK';
  return isDef
    ? `<span class="tk-opp" title="real GW1-3 opponent strength model">⚔️ opp attack ${r.att}/m (#${r.atkRank}) — ${r.atk}</span>`
    : `<span class="tk-opp" title="real GW1-3 opponent strength model">⚔️ opp defence xGA ${r.xga}/m (#${r.defRank}) — ${r.def}</span>`;
}
function osmCardHtml() {
  const rows = osmBuild();
  if (!rows.length) return '';
  const mem = osmMemo();
  const tr = rows.slice().sort((a, b) => a.defRank - b.defRank).map(r => {
    const col = r.defRank <= 5 ? 'var(--green)' : r.defRank <= 10 ? 'var(--amber)' : 'var(--red)';
    return `<tr><td><b>${esc(r.short)}</b></td><td class="num">${r.att}</td><td class="num">#${r.atkRank}</td>
      <td class="num" style="color:${col}">${r.xga}</td><td class="num">#${r.defRank}</td>
      <td><span class="xb" style="--c:${r.defRank <= 5 ? 'var(--green)' : r.defRank <= 10 ? 'var(--amber)' : 'var(--red)'}">${r.def}</span></td></tr>`;
  }).join('');
  return `<div class="card" style="grid-column:1/-1"><h2>⚔️ Opponent-strength model <span class="muted">— from real GW1-3 xG (${rows.length} teams)</span></h2>
    <p class="muted" style="margin:0 0 6px">Attack = <b>xG created per match</b> (real). Defence = <b>xG conceded per match</b> (lower is better). Ratings are shrunk to the league mean over a 3-match sample — they sharpen every week. When picking an <b>attacker</b>, target teams with a weak defence below; when picking a <b>defender/GK</b>, favour facing weak attacks.</p>
    <div style="overflow-x:auto"><table class="data compact"><tr><th>Team</th><th class="num">Attack<br>xG/m</th><th class="num">Atk<br>rank</th><th class="num">Defence<br>xGA/m</th><th class="num">Def<br>rank</th><th>Defence grade</th></tr>${tr}</table></div>
    <p class="muted" style="margin:6px 0 0">Model from official match xG · GW1-3 · sample n=3/team — a guide, not a law. The old form-adjusted FDR is still shown on fixtures; this is the real-strength view behind it.</p></div>`;
}

function renderFixtures() {
  const t = DATA.ticker;
  const past = t.past_gws, fut = t.future_gws;
  let html = '<tr><th>#</th><th>Team</th>' +
    past.map(g => `<th class="tk-h">GW${g}</th>`).join('') +
    fut.map(g => `<th class="tk-h">GW${g}</th>`).join('') + '</tr>';
  t.rows.forEach(r => {
    html += `<tr><td class="num">${r.rank}</td>
      <td class="tk-team"><span class="rk">${r.rank}</span><b>${esc(r.short)}</b>
        <span class="tk-opp" title="pts/game ${r.ppg} · xG diff/game ${r.xgd} · shots diff ${r.shotd}">${r.ppg}ppg ${r.xgd > 0 ? '+' : ''}${r.xgd}xG</span></td>` +
      r.cells.map((c, i) => {
        const gwn = i < past.length ? past[i] : fut[i - past.length];
        if (!c) return `<td class="tk tk-none" title="GW${gwn}: no match">—</td>`;
        if (c.res) return `<td class="tk res-${c.res}" title="GW${gwn} vs ${c.opp} (${c.ha}) · xG ${c.xg || 'n/a'} · shots ${c.sh}">
          <b>${c.sc}</b><span class="tk-opp">${c.opp}</span></td>`;
        return `<td class="tk" title="GW${gwn} vs ${c.opp} (${c.ha}) · base FDR ${c.fdr} · form-adjusted ${c.adj}">
          <span class="fdr f${c.adji}">${c.adji}</span> <span class="tk-opp">${c.opp}${c.ha}</span>
          <span class="adjv">${c.adj.toFixed(1)}</span></td>`;
      }).join('') + '</tr>';
  });
  $('#tickerTable').innerHTML = html;
}

function renderOsm() {
  const el = $('#osmWrap'); if (!el) return;
  try { const h2 = osmCardHtml(); el.innerHTML = h2 || ''; } catch (e) { console.error('[osm]', e); el.innerHTML = ''; }
}

function renderNews() {
  let html = `<tr><th>Player</th><th>Status</th><th>News</th><th class="num">Chance GW+1</th><th class="num">Own%</th><th class="num">Pts</th></tr>`;
  DATA.news.slice(0, 120).forEach(n => {
    html += `<tr>
      <td><b>${esc(n.name)}</b> ${posBadge(n.pos)} <span class="team-tag">${n.team}</span></td>
      <td><span class="status-badge st-${esc(n.status.split(' ')[0])}">${esc(n.status)}</span></td>
      <td style="white-space:normal;max-width:420px">${esc(n.text)}</td>
      <td class="num">${n.chance == null ? '—' : n.chance + '%'}</td>
      <td class="num">${n.own}</td><td class="num">${n.pts}</td></tr>`;
  });
  $('#newsTable').innerHTML = html;
}

// ============ Wildcard Lab ============
const avgN = (arr, n) => { const a = (arr || []).slice(0, n); return a.length ? a.reduce((s, f) => s + f.fdr, 0) / a.length : 3; };
// same inputs as the Fixtures ticker: player form + expected points + form-adjusted FDR + own-team performance rank
// horizon-aware wildcard score: sums model projections over the selected window (3 or 5 GW)
let WC_H = 3;
const pScore = (p) => {
  let s = 0;
  for (let i = 0; i < WC_H; i++) s += projP(p, i);
  return s + ownForm(p) * 0.6 + (p.pos === 'DEF' ? Math.min(2, (p.cbit || 0) * 0.05) * WC_H * 0.25 : 0);
};
let WC = null;
function buildWildcard() {
  const BUDGET = 100.0, need = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const pool = DATA.players.filter(p => p.status === 'a' && p.mins >= 60);
  const byPos = {};
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) byPos[pos] = pool.filter(p => p.pos === pos).sort((a, b) => pScore(b) - pScore(a));
  const teamCount = () => { const c = {}; Object.values(pick).flat().forEach(p => c[p.team] = (c[p.team] || 0) + 1); return c; };
  const pick = {};
  for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
    pick[pos] = []; const tc = teamCount();
    for (const p of byPos[pos]) {
      if (pick[pos].length >= need[pos]) break;
      if ((tc[p.team] || 0) >= 3) continue; // FPL rule: max 3 per club
      pick[pos].push(p); tc[p.team] = (tc[p.team] || 0) + 1;
    }
  }
  let spent = Object.values(pick).flat().reduce((s, p) => s + p.cost, 0);
  let guard = 0;
  while (spent > BUDGET && guard++ < 300) {
    let best = null;
    const tc0 = teamCount();
    for (const pos in pick) for (const sel of pick[pos]) {
      for (const alt of byPos[pos]) {
        if (pick[pos].includes(alt) || alt.cost >= sel.cost) continue;
        if (alt.team !== sel.team && (tc0[alt.team] || 0) >= 3) continue;
        const saving = sel.cost - alt.cost;
        const loss = Math.max(0.05, pScore(sel) - pScore(alt));
        const ratio = loss / saving;
        if (!best || ratio < best.ratio) best = { pos, sel, alt, saving, ratio };
        if (alt.cost < sel.cost - 3) break;
      }
    }
    if (!best) break;
    pick[best.pos] = pick[best.pos].map(p => p === best.sel ? best.alt : p);
    spent -= best.saving;
  }
  WC = { pick, spent: Object.values(pick).flat().reduce((s, p) => s + p.cost, 0) };
}
function renderWildcard() {
  if (!WC) buildWildcard();
  const fdrM = { 1: 1.15, 2: 1.08, 3: 1, 4: 0.92, 5: 0.85 };
  const all = Object.values(WC.pick).flat().sort((a, b) => pScore(b) - pScore(a));
  $('#wcMeta').textContent = `· GW${DATA.fplmeta.current_gw + 1} edition · ${WC_H}-GW fixture window · spend £${WC.spent.toFixed(1)}m of £100m · same model as the Fixtures ticker`;
  $('#wcSummary').innerHTML = `<div class="team-stats">
    <div class="tstat"><div class="v">£${WC.spent.toFixed(1)}m</div><div class="k">Total spend</div></div>
    <div class="tstat"><div class="v">${(100 - WC.spent).toFixed(1)}</div><div class="k">£m left in bank</div></div>
    <div class="tstat"><div class="v">${all.slice(0, 3).map(p => p.name).join(', ')}</div><div class="k">Headline picks</div></div>
  </div>`;
  $('#wcSquad').innerHTML = ['GK', 'DEF', 'MID', 'FWD'].map(pos => `
    <h3 style="margin:12px 0 6px;color:var(--muted);font-size:12px">${pos}</h3>` +
    WC.pick[pos].slice().sort((a, b) => pScore(b) - pScore(a)).map(p => `
    <div class="squad-row">
      <span class="pos ${p.pos}">${p.pos}</span>
      <span class="nm">${esc(p.name)} <span class="team-tag">${p.team}</span></span>
      <span class="fix">${(p.next3 || []).slice(0, 3).map(f => `${f.opp}(${f.ha})<span class="fdr f${f.afdr ?? f.fdr}" style="margin:0 2px" title="form-adjusted ${f.adjv ?? f.fdr} (base FDR ${f.fdr})">${f.afdr ?? f.fdr}</span>`).join(' ')} · team #${formRank(p)}</span>
      <span class="team-tag">form ${p.form}</span><b class="pts">${p.pts}</b><span class="team-tag">£${p.cost}m</span>
    </div>`).join('')).join('');
  const caps = all.map(p => ({ p, c: projP(p, 0) * (0.5 + 0.5 * reliab(p)) })).sort((a, b) => b.c - a.c);
  $('#wcCaptain').innerHTML = caps.slice(0, 2).map((x, i) => `
    <div class="sig-card"><div class="rank">${i ? 'V' : 'C'}</div>
      <div class="sig-info"><div class="sig-name">${esc(x.p.name)} ${posBadge(x.p.pos)} <span class="team-tag">${x.p.team} · ${((x.p.next3 || [])[0] || {}).opp || '—'}(${((x.p.next3 || [])[0] || {}).ha || '?'}) · reliability ${(reliab(x.p) * 100) | 0}%</span></div>
      <div class="sig-meta">GW ep-blend ${projP(x.p, 0).toFixed(1)} · adj FDR ${((x.p.next3 || [])[0] || {}).afdr ?? ((x.p.next3 || [])[0] || {}).fdr ?? 3} · team #${formRank(x.p)}</div></div>
      <div class="sig-pts"><div class="pts">${x.c.toFixed(1)}</div></div></div>`).join('') +
    '<p class="hint" style="margin-top:6px">Captaincy is reliability-weighted: one-week wonders (big form from a single haul) are discounted vs proven output (xG involvement per 90).</p>';
  const ctx = window.TEAMCTX;
  if (ctx) {
    const owned = new Set(ctx.squad.map(s => s.e && s.e.n));
    const keep = all.filter(p => owned.has(p.name)).map(p => p.name);
    $('#wcOverlap').innerHTML = `<p class="hint">You already own <b>${keep.length}</b> of these 15:</p>
      <div class="sig-reasons">${keep.map(k => `<span class="reason">${esc(k)}</span>`).join('') || '<span class="reason">none</span>'}</div>
      <div class="advice" style="margin-top:10px">${keep.length >= 8 ? 'Your squad is close to optimal — a wildcard may be wasted; target 1–2 upgrades instead.' : keep.length >= 5 ? 'A wildcard would change ~' + (15 - keep.length) + ' players — worth it if your bench is dead money.' : 'Your team diverges heavily from the optimal model — strong wildcard case.'}</div>
      ${ML.ready ? (() => {
        const wcp = Object.values(WC.pick).flat();
        const d = wcp.filter(p => ML.ownCount(p) === 0).map(p => p.name);
        return `<div class="advice" style="margin-top:8px">🏆 ML lens: rebuilding to this team gives you differentials none of your ${ML.n} rivals own: <b>${d.slice(0, 4).map(esc).join(', ') || '—'}</b>${keep.length >= 8 ? ' — but since rivals share your core, targeted transfers may beat a full wildcard.' : '.'}</div>`;
      })() : ''}`;
  } else {
    $('#wcOverlap').innerHTML = '<p class="hint">Load your team in <b>My Team</b> to see how many of these you already own and whether a wildcard is worth it.</p>';
  }
}

// ============ 📋 DECISION-MATRIX TRACKER (P2 polish) ============
// Honest, forward-looking: every model verdict the app gives (captain pick,
// H2H winner, transfer call) is logged with its gameweek. Once that GW's real
// results arrive, the ledger scores each call against the alternative(s) it
// named, and shows a cumulative hit-rate matrix. It starts empty from GW4 and
// grows every deadline — it will NOT pretend to have history it doesn't.
const LD_KEY = 'fpl_ledger_v1';
function ldGet() { try { return JSON.parse(localStorage.getItem(LD_KEY)) || []; } catch (e) { return []; } }
function ldSet(a) { try { localStorage.setItem(LD_KEY, JSON.stringify(a.slice(-300))); } catch (e) { } }
function ldKey(r) { return r.kind + '|' + r.gw + '|' + r.pickId; }
function ldCurGw() { return (DATA.fplmeta && DATA.fplmeta.current_gw) || 3; }
function ldRecord(kind, gw, o) {
  if (!o || !o.pickId || !gw) return;
  const a = ldGet();
  const rec = { kind, gw, pickId: o.pickId, pickName: o.pickName || String(o.pickId),
    altId: o.altId || null, altName: o.altName || null, note: o.note || '', ts: Date.now() };
  const k = ldKey(rec);
  const ix = a.findIndex(x => ldKey(x) === k);
  if (ix >= 0) a[ix] = rec; else a.push(rec);
  ldSet(a);
  return rec;
}
// actual FPL points a player scored in gameweek g (from real history), null if unknown
function ldActual(id, g) {
  const rows = (DATA.history || {})[id];
  if (!rows) return null;
  const row = rows.find(r => r[0] === g);
  return row ? row[1] : null;
}
function ldScored(rec) {
  const cur = ldCurGw();
  if (!rec || rec.gw > cur) return { rec, pending: true, pickPts: null, altPts: null, delta: null };
  const pickPts = ldActual(rec.pickId, rec.gw);
  const altPts = rec.altId != null ? ldActual(rec.altId, rec.gw) : null;
  if (pickPts == null) return { rec, pending: true, pickPts: null, altPts: null, delta: null };
  let outcome = null;
  if (altPts != null) outcome = pickPts > altPts ? 'WON' : pickPts < altPts ? 'LOST' : 'TIED';
  else if (pickPts >= 6) outcome = 'WON';            // no named rival: haul = good call
  else outcome = 'REVIEW';                            // <6 without rival -> neutral review
  return { rec, pending: false, pickPts, altPts, delta: altPts != null ? Math.round((pickPts - altPts) * 10) / 10 : null, outcome };
}
function ldStats() {
  const all = ldGet().map(ldScored);
  const done = all.filter(x => !x.pending);
  const win = done.filter(x => x.outcome === 'WON').length;
  const loss = done.filter(x => x.outcome === 'LOST').length;
  const tie = done.filter(x => x.outcome === 'TIED').length;
  const rev = done.filter(x => x.outcome === 'REVIEW').length;
  const rate = win + loss ? Math.round(100 * win / (win + loss)) : null;
  return { all, done, win, loss, tie, rev, rate, pending: all.length - done.length };
}
function ldRenderHtml() {
  const st = ldStats();
  const kindLabel = { captain: '👑 Captain', h2h: '⚖️ Pick', transfer: '🔄 Transfer' };
  const rows = st.all.slice().reverse().slice(0, 40).map(x => {
    const r = x.rec;
    if (x.pending) return `<tr><td><b>GW${r.gw}</b></td><td>${kindLabel[r.kind] || r.kind}</td><td><b>${esc(r.pickName)}</b></td>
      <td class="num"><span class="xb" style="--c:var(--amber)">awaiting GW${r.gw} result</span></td><td></td></tr>`;
    const o = x.outcome === 'WON' ? '<span class="xb" style="--c:var(--green)">WON</span>'
      : x.outcome === 'LOST' ? '<span class="xb" style="--c:var(--red)">LOST</span>'
      : x.outcome === 'TIED' ? '<span class="xb" style="--c:var(--amber)">TIED</span>' : '<span class="muted">review</span>';
    const altTxt = r.altId != null ? `vs ${esc(r.altName || r.altId)}` : '';
    return `<tr><td><b>GW${r.gw}</b></td><td>${kindLabel[r.kind] || r.kind}</td><td><b>${esc(r.pickName)}</b> ${altTxt}</td>
      <td class="num">${x.pickPts}${x.altPts != null ? ` vs ${x.altPts}` : ''} <b>${x.delta != null ? (x.delta >= 0 ? '+' : '') + x.delta : ''}</b></td><td>${o}</td></tr>`;
  }).join('');
  const header = st.rate != null
    ? `Resolved: <b>${st.done.length}</b> (${st.win}W · ${st.loss}L · ${st.tie}D · ${st.rev} review) → model win-rate <b>${st.rate}%</b> vs the named alternative.`
    : `Nothing resolved yet — every verdict below is logged now and scored when real GW${ldCurGw() + 1} results arrive.`;
  return `<div class="card"><h2>📋 Decision Matrix <span class="muted">— did the model's calls pay off?</span></h2>
    <p class="muted" style="margin:0 0 6px">${header} The ledger fills from GW${ldCurGw() + 1} as you ask for captain/H2H verdicts; it never fabricates a past record. Logged: ${st.pending} pending · ${st.done.length} scored.</p>
    <div style="overflow-x:auto"><table class="data compact"><tr><th>GW</th><th>Type</th><th>Call (vs alternative)</th><th class="num">Real pts</th><th>Outcome</th></tr>${rows || '<tr><td colspan="5" class="muted">No decisions logged yet — ask the Copilot "who should I captain?" or any "X or Y" and it will appear here, scored after the deadline.</td></tr>'}</table></div>
    <p class="muted" style="margin:6px 0 0">This is a self-audit: WON/LOST compares your pick to the named alternative's actual points in that GW. A small sample (or a strong rival) means a low win-rate is <b>not</b> proof the model is wrong — treat it as evidence accumulating week by week.</p></div>`;
}

// ============ Assistant (data-grounded copilot) ============// ============ Assistant (data-grounded copilot) ============
function scout(p) {
  const d = (p.xg_diff || 0);
  const PP = playerProb(p);
  const PS = startProb(p); const SL = selLabel(PS);
  const F = (typeof forecastOf === 'function') ? forecastOf(p) : null;
  return `<b>${esc(p.name)}</b> (${p.team}, ${p.pos}, £${p.cost}m, ${p.own}% owned)<br>
  <span class="mrow">📊 ${p.pts} pts · form ${p.form} · ep next ${p.ep_next} · ${p.g}G ${p.a}A in ${p.mins}'</span><br>
  <span class="mrow">🎯 xG ${p.xg} vs ${p.g} goals (${d >= 0 ? '+' : ''}${d.toFixed(1)} → ${d < -0.5 ? 'due a return' : d > 0.8 ? 'overperforming' : 'about right'})</span><br>
  <span class="mrow">📈 ${sparkSVG(p.id, 160, 34) || 'no match history yet'}</span><br>
  <span class="mrow">📅 ${(p.next3 || []).map(f => `${f.opp}(${f.ha})<span class="fdr f${f.afdr ?? f.fdr}" title="form-adjusted ${f.adjv ?? f.fdr} (base ${f.fdr})">${f.afdr ?? f.fdr}</span>`).join(' ')}</span><br>
  <span class="mrow">🏆 team form: #${formRank(p)} of 20 (${(window.TF[p.team] || {}).ppg ?? '–'} ppg, xG diff ${( (window.TF[p.team] || {}).xgd ?? 0) > 0 ? '+' : ''}${(window.TF[p.team] || {}).xgd ?? 0}/game — as ranked in the Fixtures ticker)</span><br>
  <span class="mrow">🎲 P(≥6) ${PP.p6}% · P(≥10) ${PP.p10}% <span class="muted">(chance ≠ prediction — real GW1-3 + pos base rate)</span> · swing ±${PP.sd.toFixed(1)}/GW</span><br>
  <span class="mrow">💷 price: ${p.price_dir === 'rise' ? '📈 rising' : p.price_dir === 'fall' ? '📉 falling' : '➖ stable'}</span><br>
  ${(() => { try { const o0 = (p.next3 || [])[0]; if (o0 && o0.opp && typeof osmOppLens === 'function') return '<span class="mrow">' + osmOppLens(o0.opp, p.pos) + '</span><br>'; return ''; } catch (e) { return ''; } })()}
  <span class="mrow">🪑 starts ~${Math.round(PS * 100)}% · <span style="color:${SL.c}">${SL.txt}</span> <span class="muted">(selection model — real GW1-3 starts + official status)</span></span>
  ${F && typeof fcMetaLine === 'function' ? fcMetaLine(F) : ''}
  <span class="mrow">${distBar(p)}</span>
  ${typeof playerScheduleSVG === 'function' ? `<span class="mrow" style="margin-top:8px">${playerScheduleSVG(p)}</span>` : ''}`;
}
function normName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// v10: scored name matching — exact > prefix > surname+first-initial > substring > word > surname.
// Ties broken by season points (the famous one wins) + team hint ("palmer che").
function findPlayer(q) {
  const Q = normName(q);
  if (!Q) return null;
  const qw = Q.split(' ');
  const qlast = qw[qw.length - 1];
  const cands = [];
  for (const p of DATA.players) {
    const N = normName(p.name);
    if (!N) continue;
    const nw = N.split(' ');
    let score = -1;
    if (N === Q) score = 100;
    else if ((N.startsWith(Q) || Q.startsWith(N)) && Math.min(N.length, Q.length) >= 4) score = 80;
    else if (qw.length > 1 && nw.length > 1 && qlast === nw[nw.length - 1] && qw[0][0] === nw[0][0] && qlast.length >= 3) score = 70;
    else if ((Q.includes(N) && N.length >= 4) || (N.includes(Q) && Q.length >= 4)) score = 60;
    else if (qw.length === 1 && nw.includes(Q) && Q.length >= 4) score = 50;
    else if (qlast.length >= 4 && qlast === nw[nw.length - 1]) score = 40;
    if (score < 0) continue;
    const hint = qw.includes((p.team || '').toLowerCase());
    if (hint) score += 10;
    cands.push({ p, score, hint });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (b.score - a.score) || ((b.p.pts || 0) - (a.p.pts || 0)));
  const [first, second] = cands;
  if (first.hint) return first.p; // explicit team word in query is always respected
  // fame override: a bare surname exactly matching an obscure player must not beat a star containing it
  if (second && second.score >= 50 && (second.p.pts || 0) >= 15 && (second.p.pts || 0) >= 3 * Math.max(1, (first.p.pts || 0))) return second.p;
  return first.p;
}

// ---- H2H decision engine (v14): "konsa or tarkowski?" should answer, not guess ----
function resolvePair(q) {
  const parts = String(q || '').split(/\s+(?:vs|versus|or|and)\s+|\s*,\s*/i).map(s => s.trim()).filter(Boolean);
  const found = [];
  for (const part of parts) {
    const p = findPlayer(part);
    if (p && !found.some(x => x.id === p.id)) found.push(p);
    if (found.length >= 2) break;
  }
  return found.length >= 2 ? found.slice(0, 2) : null;
}
function fxBadges(p) {
  return (p.next3 || []).slice(0, 3).map(f =>
    '<span class="fdr f' + (f.afdr ?? f.fdr) + '" title="GW' + f.gw + '">' + f.gw + ':' + f.opp + (f.ha === 'H' ? '(H)' : '(A)') + '</span>').join(' ');
}
function fxAvgN(p, n) {
  const t = window.TF[p.team] || {}; const a = t.afx || []; let tot = 0, c = 0;
  for (let i = 0; i < n; i++) { const v = a[i]; if (v != null) { tot += v; c++; } }
  return c ? tot / c : 3;
}
function hbar(pct, color) {
  return '<div class="x-bar"><div class="x-fill" style="width:' + Math.max(3, Math.min(100, pct)) + '%;background:' + color + '"></div></div>';
}
function teamDefLine(p) {
  if (p.pos !== 'DEF' && p.pos !== 'GK') return '<div class="muted">' + p.team + ' attacking form #' + ((window.TF[p.team] || {}).rank ?? '?') + '</div>';
  const tf = window.TF[p.team] || {};
  const g = tf.xgd != null ? (tf.xgd >= 0 ? '+' : '') + (+tf.xgd).toFixed(2) : '?';
  return '<div class="muted">🛡 ' + p.team + ' defence · form #' + (tf.rank ?? '?') + ' · xGD/g ' + g + '</div>';
}

function pairDecision(A, B, q0) {
  const ctx = window.TEAMCTX;
  const isCap = /captain|armband/.test(String(q0 || '').toLowerCase());
  const H = 5;
  const tA = hSumP(A, H), tB = hSumP(B, H);
  const lead = tA >= tB ? A : B, trail = tA >= tB ? B : A;
  const edge = Math.abs(tA - tB);
  let wA = 0, wB = 0;
  for (let i = 0; i < H; i++) { if (projP(A, i) > projP(B, i)) wA++; else if (projP(B, i) > projP(A, i)) wB++; }
  const rA = reliab(A), rB = reliab(B);
  const PPA = playerProb(A), PPB = playerProb(B);
  const fxA = fxAvgN(A, 5), fxB = fxAvgN(B, 5);
  const g0A = projP(A, 0), g0B = projP(B, 0);
  const maxT = Math.max(tA, tB);
  const row = (p, t, r) => {
    const owns = ctx && ctx.squad ? ctx.squad.some(s => s.e && s.e.n === p.name) : null;
    return '<div style="flex:1;min-width:240px">'
      + '<div style="display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap"><b>' + esc(p.name) + '</b> <span class="team-tag">' + p.team + ' · ' + p.pos + ' · £' + p.cost + 'm</span>'
      + '<span class="team-tag">' + (owns === null ? p.own + '% owned' : owns ? '✅ you own' : '❌ not owned') + '</span></div>'
      + '<div class="muted" style="margin:2px 0">Next 3: ' + (fxBadges(p) || '—') + '</div>'
      + '<div style="display:flex;justify-content:space-between"><span class="muted">xPts next GW <i>(expected)</i></span><b>' + projP(p, 0).toFixed(1) + '</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span class="muted">5-GW total</span><b>' + t.toFixed(1) + '</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span class="muted">reliability</span><b>' + Math.round(r * 100) + '%</b></div>'
      + '<div style="display:flex;justify-content:space-between"><span class="muted">minutes</span><b style="color:' + (p.mins >= 240 ? 'var(--green)' : p.mins >= 150 ? 'var(--amber)' : 'var(--red)') + '">' + p.mins + '/270</b></div>'
      + selLine(p)
      + ppRows(p)
      + distBar(p)
      + teamDefLine(p)
      + hbar(100 * t / maxT, p === lead ? 'var(--green)' : 'var(--amber)')
      + '</div>';
  };
  const lines = [];
  const share = (tA + tB) > 0 ? Math.round(100 * Math.max(tA, tB) / (tA + tB)) : 50;
  lines.push('<b style="color:var(--green)">' + esc(lead.name) + '</b> leads the 5-GW model by <b>+' + edge.toFixed(1) + '</b> projected pts ('
    + Math.max(tA, tB).toFixed(1) + ' vs ' + Math.min(tA, tB).toFixed(1) + '; ' + share + '% of the pair) and wins '
    + (lead === A ? wA : wB) + '/' + H + ' gameweeks head-to-head.');
  const leadR = lead === A ? rA : rB, trailR = lead === A ? rB : rA;
  if (trailR > leadR + 0.08) lines.push(esc(trail.name) + '\u2019s returns are more reliable (' + Math.round(trailR * 100) + '% vs ' + Math.round(leadR * 100) + '%) — the edge on ' + esc(lead.name) + ' leans on fixtures, so weigh floor vs ceiling.');
  if (Math.abs(fxA - fxB) > 0.35) lines.push('Fixture run differs: ' + esc((fxA < fxB ? A : B).name) + ' has the easier schedule (avg ' + Math.min(fxA, fxB).toFixed(1) + ' vs ' + Math.max(fxA, fxB).toFixed(1) + ' over 5).');
  // probability lens (chance ≠ expected points): surface ceiling vs floor when it actually differs
  const p10D = PPA.p10 - PPB.p10;
  if (Math.abs(p10D) >= 6) {
    const ceil = p10D > 0 ? A : B, floor = p10D > 0 ? B : A;
    const ceilP = Math.max(PPA.p10, PPB.p10), lowP = Math.min(PPA.p10, PPB.p10);
    const ceil6 = p10D > 0 ? PPA.p6 : PPB.p6, floor6 = p10D > 0 ? PPB.p6 : PPA.p6;
    lines.push('🎲 Ceiling vs floor: ' + esc(ceil.name) + ' has the bigger haul chance (P(≥10) ' + ceilP + '% vs ' + lowP + '%)'
      + (floor6 > ceil6 ? ' while ' + esc(floor.name) + ' is the steadier return (P(≥6) ' + floor6 + '% vs ' + ceil6 + '%)' : ' and also posts returns more often (P(≥6) ' + ceil6 + '%)')
      + ' — chase upside if you are behind, value the floor if you are protecting a lead.');
  } else if (Math.abs(PPA.p6 - PPB.p6) >= 15) {
    const h6 = PPA.p6 > PPB.p6 ? A : B;
    const h = Math.max(PPA.p6, PPB.p6), l = Math.min(PPA.p6, PPB.p6);
    lines.push('🎲 Return odds: ' + esc(h6.name) + ' posts a ≥6-point return far more often (P(≥6) ' + h + '% vs ' + l + '%) — the projection edge is backed by reliability, not variance.');
  }
  const loMin = (lead === A ? B : A), hiP = (lead === A ? A : B);
  if (loMin.mins < 200 && hiP.mins - loMin.mins >= 90) {
    const tf = window.TF[loMin.team] || {};
    lines.push(esc(loMin.name) + ' has only ' + loMin.mins + '/270 minutes (selection risk) — ' + (tf.rank <= 3 ? 'his team (' + loMin.team + ') has an elite defence (form #' + tf.rank + ', xGD ' + (tf.xgd >= 0 ? '+' : '') + (+tf.xgd).toFixed(2) + '/g), but clean sheets only pay when he starts.' : 'the official next-GW projection (' + loMin.ep_next + ' vs ' + hiP.ep_next + ') already prices that uncertainty in.'));
  }
  let personal = '';
  if (ctx && ctx.squad && ctx.squad.length) {
    const ownA = ctx.squad.some(s => s.e && s.e.n === A.name), ownB = ctx.squad.some(s => s.e && s.e.n === B.name);
    if (ownA && ownB) personal = '<span class="mrow">You own both — this is a <b>start/bench or captain</b> call: ' + esc((g0A >= g0B ? A : B).name) + ' projects higher next GW (' + Math.max(g0A, g0B).toFixed(1) + ' vs ' + Math.min(g0A, g0B).toFixed(1) + ').</span>';
    else if (ownA || ownB) {
      const mine = ownA ? A : B, other = ownA ? B : A;
      if (lead.name === other.name) personal = '<span class="mrow">You own ' + esc(mine.name) + ' but the model prefers ' + esc(other.name) + ' (+' + edge.toFixed(1) + ' over next 5). ' + (other.cost > ctx.maxFund ? 'He costs £' + other.cost + 'm — above your £' + ctx.maxFund.toFixed(1) + 'm budget, so you\u2019d need another sale too.' : 'Affordable within your budget (max £' + ctx.maxFund.toFixed(1) + 'm).') + '</span>';
      else personal = '<span class="mrow">You own ' + esc(mine.name) + ' and the model agrees he is the stronger pick — keep him.</span>';
    } else {
      personal = '<span class="mrow">You own neither. ' + esc(A.name) + ': ' + (A.cost <= ctx.maxFund ? '£' + A.cost + 'm fits your budget' : '£' + A.cost + 'm exceeds your £' + ctx.maxFund.toFixed(1) + 'm budget') + ' · ' + esc(B.name) + ': ' + (B.cost <= ctx.maxFund ? '£' + B.cost + 'm fits your budget' : '£' + B.cost + 'm exceeds your £' + ctx.maxFund.toFixed(1) + 'm budget') + '.</span>';
    }
  }
  try { if (typeof ldRecord === 'function' && lead && lead.id) ldRecord(isCap ? 'captain' : 'h2h', ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1, { pickId: lead.id, pickName: lead.name, altId: trail.id, altName: trail.name }); } catch (e) {}
  return '<div class="card" style="grid-column:1/-1">'
    + '<h2>⚖️ ' + (isCap ? 'Captain decision' : 'Who to pick?') + ' — ' + esc(A.name) + ' vs ' + esc(B.name) + '</h2>'
    + '<div style="display:flex;gap:18px;flex-wrap:wrap">' + row(A, tA, rA) + row(B, tB, rB) + '</div>'
    + '<p style="margin:10px 0 4px">🤖 <b>Decision: pick ' + esc(lead.name) + '</b> — ' + lines.join(' ') + '</p>'
    + (personal ? '<p class="mrow">' + personal + '</p>' : '')
    + '<p class="muted" style="margin-top:6px"><b>xPts</b> = expected points (estimate). <b>P(≥6) / P(≥10)</b> = chance of a return/haul, calibrated from real GW1-' + (DATA.fplmeta && DATA.fplmeta.current_gw ? DATA.fplmeta.current_gw : 3) + ' results (league base rate by position, blended with each player\'s own record) — a probability is not a point prediction. Open ⚖️ Compare for the full 5-GW chart, or ask a follow-up like "but which has better fixtures?".</p>'
    + '</div>';
}
function fxAvg3S(p) { return fxAvgN(p, 3); }
function suggestAnswer() {
  const ctx = window.TEAMCTX;
  if (!ctx || !ctx.squad || !ctx.squad.length) {
    const cand = DATA.players.filter(p => p.status === 'a' && p.mins >= 180)
      .map(p => ({ p, s: projP(p, 0) * (0.5 + 0.5 * reliab(p)) })).sort((a, b) => b.s - a.s)[0];
    const topBuy = (DATA.radar.buys || [])[0], topSell = (DATA.radar.sells || [])[0];
    let elite = '';
    try { if (typeof ET !== 'undefined' && ET.ready() && ET.rows().length) { const r = ET.rows(); const bi = r.slice().sort((a, b) => b.net - a.net)[0]; const so = r.slice().sort((a, b) => a.net - b.net)[0]; elite = '<span class="mrow">🧠 Real elite moves (GW' + ET.gws().last + '): bought <b>' + esc((bi || {}).name || '—') + '</b> · sold <b>' + esc((so || {}).name || '—') + '</b>.</span>'; } } catch (e) {}
    return '<b>Quick suggestions for GW' + ((DATA.fplmeta && DATA.fplmeta.next_gw) || '?') + '</b><br>'
      + '<span class="mrow">🎯 Model captain: <b>' + (cand ? esc(cand.p.name) : '—') + '</b> (score ' + (cand ? cand.s.toFixed(1) : '') + '). Cross-check vs your squad.</span>'
      + (topBuy ? '<span class="mrow">🔥 League most-bought: <b>' + esc(topBuy.p.name) + '</b> (' + fmtK(topBuy.p.t_in) + ' in this GW).</span>' : '')
      + (topSell ? '<span class="mrow">🔻 League most-sold: <b>' + esc(topSell.p.name) + '</b> (' + fmtK(topSell.p.t_out) + ' out) — understand why before following.</span>' : '')
      + elite
      + '<span class="mrow">💡 <b>Want it personal?</b> Load your team in My Team, then ask again — or ask a head-to-head like "konsa or tarkowski?", "Haaland or Palmer as captain?".</span>';
  }
  const starters = ctx.squad.filter(s => s.e && s.verdicts && s.verdicts.some(v => v[0] === 'START'));
  const cap3 = starters.slice().sort((a, b) => (b.cap || 0) - (a.cap || 0)).slice(0, 2);
  const sells = ctx.squad.filter(s => s.e && s.verdicts && s.verdicts.some(v => v[0] === 'SELL?')).sort((a, b) => a.ep - b.ep);
  const POSL = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  let replTxt = '';
  const s0 = sells[0];
  if (s0 && s0.e) {
    const cand = DATA.players.filter(p => p.status === 'a' && p.mins >= 90 && p.cost <= ctx.maxFund && p.pos === POSL[s0.pos] && !ctx.squad.some(x => x.e && x.e.n === p.name))
      .map(p => ({ p, sc: (p.ep_next || 0) * (0.6 + 0.4 * reliab(p)) + (3 - fxAvg3S(p)) * 0.8 }))
      .sort((a, b) => b.sc - a.sc)[0];
    replTxt = cand ? '<span class="mrow">🛒 Replace <b>' + esc(s0.e.n) + '</b> (ep ' + s0.ep.toFixed(1) + ') with <b>' + esc(cand.p.name) + '</b> (' + cand.p.team + ', £' + cand.p.cost + 'm, ep ' + cand.p.ep_next + ') — fits your £' + ctx.maxFund.toFixed(1) + 'm budget.</span>'
      : '<span class="mrow">⚠️ Weakest flagged: <b>' + esc(s0.e.n) + '</b> — no clearly better affordable replacement in that slot right now; don\u2019t force a -4.</span>';
  } else replTxt = '<span class="mrow">✅ No weak links flagged — squad structure is healthy.</span>';
  const benchTip = (ctx.benchWaste != null && ctx.benchWaste > 4) ? '<span class="mrow">🧊 Bench waste ' + ctx.benchWaste.toFixed(1) + ' pts — one tidy upgrade beats repeated -4 hits.</span>' : '';
  return '<b>Personalised suggestions — ' + esc(ctx.entryName) + ' (rank ' + (ctx.rank || 0).toLocaleString() + ')</b><br>'
    + (cap3.length ? '<span class="mrow">🎯 Captain next GW: <b>' + esc(cap3[0].e.n) + '</b> (cap ' + cap3[0].cap.toFixed(1) + ')' + (cap3[1] ? ' · alt ' + esc(cap3[1].e.n) + ' (' + cap3[1].cap.toFixed(1) + ')' : '') + '.</span>' : '')
    + replTxt + benchTip
    + '<span class="mrow">🏆 ' + (window.ML && ML.ready ? 'Mini-league mode active — follow the 🏆 tab risk rules before any hit.' : 'Load your mini league (🏆 tab) and every move gets optimised toward 1st place.') + '</span>'
    + '<span class="mrow">💡 Ask "who should I captain", "best transfer this week", or a head-to-head like "konsa or tarkowski?" for specifics.</span>';
}

function osmAsk(q) {
  const rows = osmBuild();
  if (!rows.length) return '';
  const Q = String(q || '').toLowerCase();
  const escq = x => esc(x);
  const row = r => `<span class="mrow">• <b>${escq(r.short)}</b> <span class="muted">xG ${r.att}/m (#${r.atkRank} atk) · xGA ${r.xga}/m (#${r.defRank} def) · ${r.def}</span></span>`;
  const by = (fn) => rows.slice().sort(fn);
  if (/weak|leak|worst|easiest|target|porous/.test(Q) && /defen|conced|defen|against/.test(Q)) {
    const d = by((a, b) => b.xga - a.xga);
    return `⚔️ Leakiest defences to attack (real GW1-3 xG conceded per match):<br>${d.slice(0, 5).map(row).join('')}<br><span class="muted">Attackers facing these teams have the friendliest matchups on real data — but each still needs a minutes + fixture sanity check.</span>`;
  }
  if (/best|strong|solid|elite/.test(Q) && /defen|defens|def/.test(Q)) {
    const d = by((a, b) => a.xga - b.xga);
    return `🛡️ Best real defences (fewest xG conceded per match, GW1-3):<br>${d.slice(0, 5).map(row).join('')}<br><span class="muted">Good sources of DEF/GK clean sheets — but defenders only score when they start (see selection model).</span>`;
  }
  if (/best|strong|elite|top/.test(Q) && /attack|scor|creat/.test(Q)) {
    const d = by((a, b) => b.att - a.att);
    return `⚔️ Strongest real attacks (most xG created per match, GW1-3):<br>${d.slice(0, 5).map(row).join('')}<br><span class="muted">Attacking assets from these teams have the best real-creation base to build on.</span>`;
  }
  return '';
}

function askAI(q) {
  const Q = q.toLowerCase();
  const ctx = window.TEAMCTX;
  // v31 routing fix (B1): named-pair H2H decisions outrank elite & captain interception
  const _pair = resolvePair(q);
  if (_pair && !/^\s*(compare|open in compare)/i.test(Q)) return pairDecision(_pair[0], _pair[1], q);
  const pl = findPlayer(q);
  // B9: single named player + fixture words -> their own scout report / schedule strip
  if (pl && /(fixture|schedule|run|next gw|upcoming)/.test(Q) && !/(sell|drop|bench|captain|armband|buy|bring|compare|versus|mini|league|rival|wildcard|chip)/.test(Q)) return scout(pl);
  // B9: position + price intent ("best DEF under 6m") answers with players, not team defences
  const ppPos = (/(?:^|[^a-z])(gk|goalkeeper|def|defender|mid|midfielder|fwd|forward|striker)s?(?:[^a-z]|$)/.exec(Q) || [])[1];
  const ppPrice = /under\s*£?(\d+(?:\.\d+)?)m?\b/.exec(Q);
  const POSPP = { gk:'GK', goalkeeper:'GK', def:'DEF', defender:'DEF', mid:'MID', midfielder:'MID', fwd:'FWD', forward:'FWD', striker:'FWD' };
  if (ppPos && ppPrice && !/(defence|defense|attack|strength|conced|leak|porous)/.test(Q)) {
    const code = POSPP[ppPos.toLowerCase()], budget = parseFloat(ppPrice[1]);
    const top = DATA.players
      .filter(p => p.status === 'a' && p.mins >= 60 && p.cost <= budget && p.pos === code && (p.ep_next || 0) >= 1 && !(ctx && ctx.squad && ctx.squad.some(s => s.e && s.e.n === p.name)))
      .map(p => ({ p, f: (typeof forecastOf === 'function') ? forecastOf(p) : null }))
      .sort((a, b) => ((b.f && b.f.xp) || (b.p.ep_next || 0)) - ((a.f && a.f.xp) || (a.p.ep_next || 0))).slice(0, 4);
    if (top.length) {
      return `Best ${code} under £${budget.toFixed(1)}m (ranked by model xP):<br>` + top.map(t => {
        const f = t.f || {};
        const xTxt = f && f.xp != null ? 'xP ' + f.xp.toFixed(1) : 'ep ' + (t.p.ep_next || 0).toFixed(1);
        return `<span class="mrow">• <b>${esc(t.p.name)}</b> (${t.p.team}, £${t.p.cost}m, ${t.p.own}% owned) — ${xTxt}${f && f.p6 ? ' · P(≥6) ' + f.p6 + '%' : ''}${f && f.minutes ? ' · starts ~' + Math.round(f.minutes.pStart * 100) + '%' : ''}</span>`;
      }).join('') + '<br><span class="muted">Model estimates from real GW1-3 data — check the fixture before you buy.</span>';
    }
  }
  // Elite intel answers only genuinely elite-flavoured questions (B1/B9: captain/H2H/rate-my-team no longer shadowed)
  if (DATA.elite && (DATA.elite.elites || []).length && /elite|weighted|skill.?weight|proven|template|captained|captaincy|armband|differential|deadline|top signals|movers|cohort|bought|sold|top-?10k|top-?1k/.test(Q)) {
    try { const er = (typeof eliteAsk === 'function') ? eliteAsk(q) : null; if (er) return er; } catch (e) { console.error('[ELITE ask]', e); }
  }
  if (!pl && /(defence|defense|def|attack|strength|conced)/.test(Q) && /(best|strong|weak|worst|easiest|hardest|elite|leak|top|solid|porous)/.test(Q)) {
    try { const oa = typeof osmAsk === 'function' ? osmAsk(Q) : ''; if (oa) return oa; } catch (e) { console.error('[osmAsk]', e); }
  }
  if (/captain|armband/.test(Q)) {
    if (ctx) {
      const ranked = ctx.squad.map(s => ({ s, c: s.cap })).sort((a, b) => b.c - a.c).slice(0, 3);
      try { if (typeof ldRecord === 'function' && ranked[0]) { const tid = ranked[0].s && ranked[0].s.r && ranked[0].s.r.element; if (tid) ldRecord('captain', ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1, { pickId: tid, pickName: ranked[0].s.e ? ranked[0].s.e.n : String(tid), altId: (ranked[1] && ranked[1].s.r && ranked[1].s.r.element) || null, altName: ranked[1] && ranked[1].s.e ? ranked[1].s.e.n : null }); } } catch (e) {}
      let lev = '';
      if (window.ML && ML.ready && ML.capCands && ML.capCands.length) {
        const field = ML.capCands.slice().sort((a, b) => (b.rivCap || 0) - (a.rivCap || 0) || (b.x.ep || 0) - (a.x.ep || 0))[0];
        const top = ranked[0];
        if (field && top && top.s && top.s.e) {
          const topId = top.s.r && top.s.r.element;
          // v30 single forecast brain: both sides read the SAME model forecast when in the catalog
          const topF = (typeof fcOfId === 'function') ? fcOfId(topId) : null;
          const fieldF = (typeof fcOfId === 'function') ? fcOfId(field.x.id) : null;
          const topXp = topF ? topF.xp : top.s.ep;
          const fieldXp = fieldF ? fieldF.xp : field.x.ep;
          const L = capLev({ name: top.s.e.n, ep: topXp, p6: topF ? topF.p6 : (ppOfId(topId) || {}).p6, p10: topF ? topF.p10 : (ppOfId(topId) || {}).p10 },
                           { name: field.x.e.n, ep: fieldXp, p6: fieldF ? fieldF.p6 : (ppOfId(field.x.id) || {}).p6, p10: fieldF ? fieldF.p10 : (ppOfId(field.x.id) || {}).p10 });
          const col = capLevColor(L.cls);
          const same = top.s.e.n === field.x.e.n;
          lev = `<br><span class="mrow">⚔️ Captain leverage vs your mini league: ${same ? `rivals also mostly captain <b>${esc(field.x.e.n)}</b> (${field.rivCap}/${ML.n}) — zero leverage, which is exactly the safe play` : `the field (${field.rivCap}/${ML.n} rivals) is on <b>${esc(field.x.e.n)}</b> (xP ${fieldXp.toFixed(1)}); your top option <b>${esc(top.s.e.n)}</b> (xP ${topXp.toFixed(1)}) is <b style="color:${col}">${(L.eEp > 0 ? '+' : '')}${L.eEp.toFixed(1)} xP</b> vs the field · ${L.txt}`}. Leverage = model estimate, single-GW.</span>`;
        }
      }
      return `For <b>GW${ctx.picksGw + 1}</b>, your captain options ranked by model projection (xP):<br>` +
        ranked.map((x, i) => `<span class="mrow">${i + 1}. <b>${esc(x.s.e.n)}</b> — ${((x.s.fxs[0] || {}).opp) || '—'}(${(x.s.fxs[0] || {}).ha || '?'}), adj FDR ${(x.s.fxs[0] || {}).afdr ?? (x.s.fxs[0] || {}).fdr ?? 3}, model xP ${x.s.ep.toFixed(1)}</span>`).join('') +
        `<br><span class="mrow">Verdict: <b>${esc(ranked[0].s.e.n)}</b> is the standout${ranked[1] ? '; ' + esc(ranked[1].s.e.n) + ' the safe vice.' : '.'}</span>` + lev;
    }
    const g0 = DATA.captains[0];
    const pickTxt = DATA.captains.slice(0, 3).map(c => {
      if (!g0 || c === g0) return `<b>${esc(c.name)}</b> (ep ${c.ep})`;
      const L = capLev({ name: c.name, ep: c.ep }, { name: g0.name, ep: g0.ep });
      const col = capLevColor(L.cls);
      return `<b>${esc(c.name)}</b> (ep ${c.ep}) <b style="color:${col}">${(L.eEp > 0 ? '+' : '')}${L.eEp.toFixed(1)}</b> vs #1`;
    }).join(', ');
    return `Global captain picks this GW (official FPL xP / ep_next — not our model) with edge vs the #1 field pick: ${pickTxt}.<br>`
      + `<span class="mrow">💡 Captain choice is <b>leverage</b>: an expected edge over the field only matters if you own the pick and rivals don't captain it. Load your team + mini league for a personalised verdict.</span>`;
  }
  if (/wildcard/.test(Q)) {
    renderWildcard();
    const all = Object.values(WC.pick).flat().sort((a, b) => pScore(b) - pScore(a));
    let extra = '';
    if (ctx) {
      const keep = all.filter(p => ctx.squad.some(s => s.e && s.e.n === p.name)).length;
      extra = `<br><span class="mrow">You own <b>${keep}/15</b> of the model team → ${keep >= 8 ? 'wildcard probably NOT needed; do targeted transfers.' : keep >= 5 ? 'borderline — wildcard if your bench is dead money.' : 'strong wildcard case.'}</span>`;
    }
    return `Current model wildcard team headlines: <b>${all.slice(0, 5).map(p => p.name).join(', ')}</b>. ${extra}<br><span class="mrow">Open the <b>Wildcard Lab</b> tab for the full 15 + captain.</span>`;
  }
  if (/(sell|drop|get rid|remove)/.test(Q)) {
    const t = pl || (ctx ? ctx.squad.filter(s => s.verdicts.some(v => v[0] === 'SELL?')).sort((a, b) => a.ep - b.ep)[0] : null);
    const p = t && t.e ? DATA.players.find(x => x.name === t.e.n) : t;
    if (!p) return 'Tell me who you mean — e.g. "should I sell Thiago?"';
    const bad = (p.xg_diff > 0.8) || ((p.next3 || []).length && adjAvg3(p) >= 3.2) || p.price_dir === 'fall' || (p.status !== 'a') || formRank(p) >= 16;
    return `${scout(p)}<br><span class="mrow">🤖 Verdict: ${bad ? '<b>Sell candidate</b> — ' + (p.status !== 'a' ? 'fitness risk.' : p.xg_diff > 0.8 ? 'riding luck on xG.' : formRank(p) >= 16 ? `his team ranks #${formRank(p)} for performance.` : 'fixtures/price turning away.') : '<b>Hold</b> — underlying numbers are fine; fixtures ' + (adjAvg3(p) <= 2.8 ? 'are kind.' : 'are tough but the stats support him.')}</span>`;
  }
  if (/(buy|bring in|transfer in|target|replace)/.test(Q)) {
    const posMatch = /(gk|def|mid|fwd|goalkeeper|defender|midfielder|forward)/.exec(Q);
    const under = /under (\d+(?:\.\d+)?)/.exec(Q);
    const posMap = { gk: 'GK', goalkeeper: 'GK', def: 'DEF', defender: 'DEF', mid: 'MID', midfielder: 'MID', fwd: 'FWD', forward: 'FWD' };
    const budget = ctx ? ctx.maxFund : (under ? parseFloat(under[1]) : 100);
    let cands = DATA.players.filter(p => p.status === 'a' && p.mins >= 90 && p.cost <= budget && adjAvg3(p) <= 2.9)
      .sort((a, b) => (b.ep_next + (b.form || 0) * 0.5 + ownForm(b)) - (a.ep_next + (a.form || 0) * 0.5 + ownForm(a)));
    if (posMatch) cands = cands.filter(p => p.pos === posMap[posMatch[1]]);
    if (ctx) cands = cands.filter(p => !ctx.squad.some(s => s.e && s.e.n === p.name));
    const top = cands.slice(0, 3);
    return top.length ? `Best value in budget (£${budget.toFixed(1)}m)${posMatch ? ' at ' + posMap[posMatch[1]] : ''}:<br>` + top.map(p => `<span class="mrow">• ${scout(p)}</span>`).join('') : 'Nothing affordable with good fixtures — consider selling a bench earner first to raise funds.';
  }
  if (/bench/.test(Q)) {
    if (!ctx) return 'Load your team first (My Team tab) so I can rank your bench.';
    const b = ctx.squad.slice().sort((a, b2) => b2.cap - a.cap).slice(-4);
    return `For GW${ctx.picksGw + 1}, your weakest projections (bench them):<br>` + b.map(s => `<span class="mrow">• <b>${esc(s.e.n)}</b> — ${((s.fxs[0] || {}).opp) || '—'}(${(s.fxs[0] || {}).ha || '?'} adj FDR ${(s.fxs[0] || {}).afdr ?? (s.fxs[0] || {}).fdr ?? 3}), model xP ${s.ep.toFixed(1)}</span>`).join('') + `<br><span class="mrow">Bench waste if all sit: ${b.reduce((s, x) => s + x.ep, 0).toFixed(1)} model xP.</span>`;
  }
  if (/(injur|fit|doubt|hurt|return)/.test(Q)) {
    const flagged = ctx ? ctx.squad.filter(s => s.flagged) : [];
    if (ctx && flagged.length) return `Your flagged players:<br>` + flagged.map(s => `<span class="mrow">• <b>${esc(s.e.n)}</b> — ${esc((DATA.news.find(n => n.name === s.e.n) || {}).text || 'flagged')}</span>`).join('');
    return `League-wide biggest concerns: ${DATA.news.slice(0, 5).map(n => `${n.name} (${n.status})`).join(', ')}. Your squad has no flagged players. ✅`;
  }
  if (/chip/.test(Q)) {
    if (!ctx) return 'Load your team to see chip status.';
    return `Chips: <b>${ctx.usedChips.length ? ctx.usedChips.join(', ') + ' used' : 'none used'}</b>; remaining: ${ctx.chipsLeft.join(', ') || 'none'}. ${ctx.usedChips.includes('wildcard') ? 'Wildcard gone — plan Free Hit for a double GW and Bench Boost when your bench has easy fixtures.' : 'Wildcard still live — check your Wildcard Lab overlap score before pulling it.'}`;
  }
  if (/(rate|overview|how is my team|think of my team|my team\?)/.test(Q)) {
    if (!ctx) return "Load your team in the My Team tab and I'll give you a full audit.";
    const strengths = ctx.squad.slice().sort((a, b) => b.ep - a.ep).slice(0, 3);
    const weak = ctx.squad.slice().sort((a, b) => b.a5 - a.a5).slice(0, 3);
    return `<b>${esc(ctx.entryName)}</b> — ${ctx.totalPts} pts, rank ${ctx.rank.toLocaleString()}, value £${ctx.value}m.<br>
    <span class="mrow">💪 Core: ${strengths.map(s => esc(s.e.n)).join(', ')} carry your projections.</span><br>
    <span class="mrow">⚠️ Fixture worries: ${weak.map(s => `${esc(s.e.n)} (avg FDR ${s.a5.toFixed(1)})`).join(', ')}.</span><br>
    <span class="mrow">🧮 Projected best XI: ${ctx.proj.toFixed(1)} pts next GW · bench waste ${ctx.benchWaste.toFixed(1)}.</span><br>
    <span class="mrow">Ask "who to bench", "best transfer" or "should I wildcard" for next steps.</span>`;
  }
  if (/fixture|run|schedule/.test(Q)) {
    if (!ctx) return 'Load your team for a personalised fixture view, or open the Fixtures tab.';
    const g = {};
    ctx.squad.forEach(s => { if (s.t) g[s.t.code] = g[s.t.code] || { short: s.t.short, a5: s.a5 }; });
    return `Your clubs' next-5 difficulty (easiest first):<br>` + Object.values(g).sort((a, b) => a.a5 - b.a5).map(r => `<span class="mrow">• <b>${r.short}</b> — avg ${r.a5.toFixed(1)} ${r.a5 <= 2.2 ? '🟢' : r.a5 <= 3 ? '🟡' : '🔴'}</span>`).join('');
  }
  if (/compare| vs |versus/.test(Q)) {
    const parts = Q.split(/ vs | versus | and |,| or /).map(s => findPlayer(s)).filter(Boolean);
    if (parts.length >= 2) {
      $('#cmpA').value = parts[0].name; $('#cmpB').value = parts[1].name;
      renderCompare();
      return `Comparison ready — open the <b>⚖️ Compare</b> tab. Quick answer: ${(() => { let sa = 0, sb = 0; for (let i = 0; i < 5; i++) { sa += projP(parts[0], i); sb += projP(parts[1], i); } return sa >= sb ? `<b>${esc(parts[0].name)}</b> +${(sa - sb).toFixed(1)} proj over next 5.` : `<b>${esc(parts[1].name)}</b> +${(sb - sa).toFixed(1)} proj over next 5.`; })()}`;
    }
    return 'Tell me two players, e.g. "compare Saka vs Palmer".';
  }
  if (/(mini|league|rival|beat the leader|win my)/.test(Q)) return mlSummary();
  if (/\bhit\b|take a hit/.test(Q)) {
    if (!ML.ready) return 'Load your mini league (🏆 tab) and I\'ll judge hits against your position — a -4 that\'s right in ATTACK mode can be wrong in DEFEND mode.';
    return `🚨 Hit verdict: ${ML.hitText}`;
  }
  if (/chip battle|chips vs/.test(Q)) {
    if (!ML.ready) return 'Load your mini league first to see the chip battle vs your rivals.';
    return ALL_CHIPS.map(([k, l]) => `${l}: you ${ML.youChips.includes(k) ? '❌ used' : '✅ hold'} · main rival ${ML.prim && ML.prim.chips.includes(k) ? '❌ used' : '✅ hold'}`).join('<br>') + (ML.youChips.includes('3xc') && ML.prim && ML.prim.chips.includes('3xc') ? '<br>Both hold TC — timing is the weapon.' : '');
  }
  if (/(suggest|improve|advice|recommend|what should i do|next step|make my team better|how can i improve|any suggestions)/.test(Q)) return suggestAnswer();
  if (pl) return scout(pl);
  return `I can help with: <b>captain</b> picks, <b>sell/buy</b> advice (budget-aware), <b>bench</b> choices, <b>injuries</b>, <b>chips</b>, <b>fixtures</b>, your <b>mini league</b> ("how do I win my mini league?", "should I take a hit?"), any <b>player scout report</b> ("Haaland?"), "best DEF under 6m", or <b>wildcard</b> strategy. ${ctx ? '' : 'Tip: load your team in My Team for personalised answers.'}`;
}
function renderLedger() {
  const el = $('#ledgerOut'); if (!el) return;
  try { el.innerHTML = ldRenderHtml(); } catch (e) { console.error('[ledger]', e); el.innerHTML = ''; }
}

function chat(q) {
  const log = $('#chatLog');
  log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(q)}</div>`);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => {
    log.insertAdjacentHTML('beforeend', `<div class="msg bot">${askAI(q)}</div>`);
    log.scrollTop = log.scrollHeight;
  }, 30);
}
$('#chatSend').onclick = () => { const v = $('#chatInput').value.trim(); if (v) { chat(v); $('#chatInput').value = ''; } };
$('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#chatSend').click(); });
$$('#quickQs .chip').forEach(c => c.onclick = () => chat(c.textContent));
$('#chatLog').innerHTML = `<div class="msg bot">👋 I'm your <b>FPL Copilot</b>. I know the full 2026/27 dataset (' + DATA.players.length + ' players, fixtures, xG, prices) — and once you load your team in <b>My Team</b>, every answer becomes personal. Try the quick questions!</div>`;

// ============ 🏆 MINI LEAGUE WINNING ENGINE (relative optimization) ============
// Objective (per spec): maximise P(finish 1st in YOUR league), not raw points.
const ML = window.ML = { ready: false };
const FM = { 1: 1.15, 2: 1.08, 3: 1, 4: 0.92, 5: 0.85 };
const mlGw = () => DATA.fplmeta.current_gw || 3; // latest published picks (next-GW picks 404 until deadline)
const mlCacheGet = k => { try { return JSON.parse(localStorage.getItem('ml_' + k)); } catch (e) { return null; } };
const mlCacheSet = (k, v) => { try { localStorage.setItem('ml_' + k, JSON.stringify(v)); } catch (e) { } };

// ---- Win-probability simulator (real evidence · pure & testable) ----
// Every manager's WEEKLY volatility is estimated from their REAL per-GW points
// this season (official entry history) and shrunk toward a league-wide prior,
// because a 2-3 GW sample is noisy. All outputs are labelled model estimates.
const ML_POP_SD = 12.5;   // prior: typical weekly score spread across FPL managers
const ML_SHRINK_K = 4;    // shrinkage strength — fewer real GWs → closer to prior
// Strategy profiles applied to YOU over the remaining season (labelled estimates).
const ML_PLANS = [
  { key: 'Safe',       muAdj: -0.40, sdMul: 0.90,  why: 'template-heavy: protects what you have (slightly lower raw output, lower weekly swing)' },
  { key: 'Balanced',   muAdj: +0.60, sdMul: 1.00,  why: 'solid upgrades with modest differentiation' },
  { key: 'Aggressive', muAdj: +1.60, sdMul: 1.25,  why: 'chases differential upside: higher expected points AND higher swing' },
];
// Real weekly volatility from an entry's actual per-GW scores (official history).
function mlVol(gwPoints) {
  const xs = (gwPoints || []).filter(x => x != null && isFinite(x)).map(Number);
  const n = xs.length;
  if (n < 1) return { n: 0, avg: null, rawSd: null, sd: ML_POP_SD };
  const avg = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((s, x) => s + (x - avg) * (x - avg), 0);
  const rawSd = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
  const w = n / (n + ML_SHRINK_K); // weight on the observed sd
  const sd = Math.max(6, Math.min(22, w * rawSd + (1 - w) * ML_POP_SD));
  return { n, avg, rawSd, sd };
}
function mulberry32(seed) { // deterministic PRNG → reproducible sims
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mlRandn(rng) { // standard normal via Box–Muller
  let u = 0, v = 0;
  while (!u) u = rng(); while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// Season-long Monte-Carlo over the field, one manager at a time.
//  you:   { total (banked pts), mu (expected weekly pts), sd (real weekly vol) }
//  field: [{ total, mu, sd }] relevant rivals
//  plans: strategy deltas applied to YOU (default ML_PLANS)
// Each plan returns winPct + a real final-points band (p10/med/p90).
//  (gws iid draws collapse to sd*sqrt(gws)*Z — mathematically identical.)
function mlSimulate(you, field, plans, opts) {
  const N = (opts && opts.sims) || 2400;
  const gws = Math.max(1, (opts && opts.gws) || 1);
  const rng = (opts && opts.rng) || mulberry32(20260908);
  const root = Math.sqrt(gws);
  const out = {};
  for (const pl of plans) {
    const muY = you.mu + (pl.muAdj || 0);
    const sdY = Math.max(4, you.sd * (pl.sdMul || 1));
    const fin = [];
    let win = 0;
    for (let i = 0; i < N; i++) {
      const fY = you.total + muY * gws + sdY * root * mlRandn(rng);
      fin.push(fY);
      let best = fY;
      for (const rv of field) {
        const f = rv.total + rv.mu * gws + rv.sd * root * mlRandn(rng);
        if (f > best) best = f;
      }
      if (best === fY) win++; // ties count as your win (you were first past the post)
    }
    fin.sort((a, b) => a - b);
    const q = p => fin[Math.min(N - 1, Math.max(0, Math.round(p * (N - 1))))];
    out[pl.key] = {
      winPct: Math.round(100 * win / N),
      p10: Math.round(q(0.10) * 10) / 10,
      med: Math.round(q(0.50) * 10) / 10,
      p90: Math.round(q(0.90) * 10) / 10,
    };
  }
  return out;
}

async function mlFetchEntry(id) {
  const ck = id + '_' + mlGw() + '_v2'; // v2: also caches real per-GW history
  const c = mlCacheGet(ck);
  if (c) return c;
  const [picks, hist] = await Promise.all([
    fplApi(`entry/${id}/event/${mlGw()}/picks/`),
    fplApi(`entry/${id}/history/`),
  ]);
  const out = {
    picks,
    chips: (hist.chips || []).map(x => x.name),
    gwPts: (hist.current || []).map(e => e.points), // REAL weekly scores this season
  };
  mlCacheSet(ck, out);
  return out;
}

function mlSquadStats(picks, EL, TM) {
  const start = [], bench = []; let cap = null, vice = null;
  for (const r of picks.picks) {
    const e = EL[r.element];
    const tShort = e && TM[e.t] ? TM[e.t].short : null;
    const rec = { id: r.element, e, tShort, ep: e ? (e.ep || 0) : 0 };
    if (r.is_captain) cap = rec;
    if (r.is_vice_captain) vice = rec;
    (r.position <= 11 ? start : bench).push(rec);
  }
  const clubs = {}; start.forEach(x => { if (x.tShort) clubs[x.tShort] = (clubs[x.tShort] || 0) + 1; });
  const adj = start.filter(x => x.tShort).map(x => (window.TF[x.tShort] || {}).af3 || 3);
  return {
    start, bench, cap, vice,
    idsSet: new Set([...start, ...bench].map(x => x.id)),
    startNames: start.filter(x => x.e).map(x => x.e.n),
    mu: start.reduce((s, x) => s + x.ep, 0) + (cap ? cap.ep : 0) + 0.8,
    clubMax: Math.max(0, ...Object.values(clubs)),
    flagged: [...start, ...bench].filter(x => x.e && x.e.s && x.e.s !== 'a').length,
    avgAdj3: adj.length ? adj.reduce((a, b) => a + b, 0) / adj.length : 3,
    benchEp: bench.reduce((s, x) => s + x.ep, 0),
  };
}

async function mlLoadLeague() {
  const id = ($('#mlLeagueId').value || localStorage.getItem('mlLeague') || '').trim();
  if (!id) { $('#mlStatus').textContent = 'Paste your mini-league ID first (from the league page URL).'; return; }
  localStorage.setItem('mlLeague', id);
  $('#mlStatus').textContent = 'Loading standings…';
  try {
    const st = await fplApi(`leagues-classic/${id}/standings/`);
    ML.rows = st.standings.results; ML.leagueId = id;
    const youId = window.TEAMCTX && window.TEAMCTX.entryId;
    if (youId && ML.rows.some(r => r.id === youId)) { await mlBuild(youId); return; }
    $('#mlYou').style.display = 'flex';
    $('#mlYouSelect').innerHTML = ML.rows.map(r => `<option value="${r.id}">${esc(r.entry_name)} — ${r.total} pts (#${r.rank})</option>`).join('');
    $('#mlYouSelect').onchange = () => mlBuild(+$('#mlYouSelect').value);
    $('#mlStatus').textContent = `League loaded (${ML.rows.length} teams). Tip: load your team in My Team next time and I'll auto-detect you. Select your entry:`;
  } catch (e) { $('#mlStatus').textContent = 'Could not load that league: ' + e.message; }
}

async function mlBuild(youId) {
  $('#mlStatus').textContent = 'Scouting relevant rivals…';
  const ids = await loadIds();
  const sorted = ML.rows.slice().sort((a, b) => a.rank - b.rank);
  const you = sorted.find(r => r.id === youId);
  const curGw = DATA.fplmeta.current_gw, gwsLeft = Math.max(1, 38 - curGw);
  const yi = sorted.findIndex(r => r.id === youId);
  const rivals = [];
  const push = r => { if (r && r.id !== youId && !rivals.includes(r)) rivals.push(r); };
  push(sorted[0]);
  for (let i = yi - 1; i >= 0 && rivals.length < 4; i--) push(sorted[i]);
  for (let i = yi + 1; i < sorted.length && rivals.length < 6; i++) push(sorted[i]);

  let youData;
  try { youData = await mlFetchEntry(youId); } catch (e) { $('#mlStatus').textContent = 'That entry\'s lineup is private or unavailable — pick another entry (or load your team in My Team first).'; return; }
  const EL = ids.elements, TM = ids.teams;
  const youS = mlSquadStats(youData.picks, EL, TM);
  const R = [];
  for (const r of rivals) {
    try {
      const d = await mlFetchEntry(r.id);
      R.push({ row: r, s: mlSquadStats(d.picks, EL, TM), chips: d.chips, gwPts: d.gwPts });
    } catch (e) { /* skip unreachable rival */ }
  }

  const leader = sorted[0];
  const gap = leader.total - you.total;
  const above = sorted.slice(0, yi).slice(-1)[0] || leader;
  const catchRate = gap / gwsLeft;
  let mode;
  if (you.rank === 1) mode = 'DEFEND';
  else if (gap <= Math.max(10, gwsLeft)) mode = 'CONSOLIDATE';
  else if (gap <= gwsLeft * 3) mode = 'ATTACK';
  else mode = 'ALLIN';
  const modeTxt = {
    DEFEND: 'You lead (or the gap says protect). Minimise variance: template players, match dangerous captains, no needless differentials.',
    CONSOLIDATE: 'Close enough to strike selectively: keep the template core, add 1–3 high-value differentials, differentiate captain only when the maths says so.',
    ATTACK: 'Behind but catchable: target players your rivals do NOT own, exploit fixture swings, consider differential captains and strategic chips.',
    ALLIN: 'Large gap, so safety will not win it: every recommendation maximises expected differential vs rivals — but each still has a football rationale, no gambling.',
  }[mode];

  const youChips = youData.chips;
  const n = R.length || 1;
  // shared / unique / captain exposure per rival
  R.forEach(rv => {
    rv.shared = [...rv.s.idsSet].filter(id => youS.idsSet.has(id)).length;
    rv.onlyThem = [...rv.s.idsSet].filter(id => !youS.idsSet.has(id));
    rv.onlyYou = [...youS.idsSet].filter(id => !rv.s.idsSet.has(id));
  });
  // threats: owned by many rivals, not by you
  const cnt = {};
  R.forEach(rv => rv.s.idsSet.forEach(id => { if (!youS.idsSet.has(id)) cnt[id] = (cnt[id] || 0) + 1; }));
  const threats = Object.entries(cnt).map(([id, c]) => ({ id: +id, c, e: EL[+id] }))
    .filter(t => t.e && t.c >= Math.max(2, Math.ceil(n / 2)))
    .sort((a, b) => (b.e.ep || 0) - (a.e.ep || 0)).slice(0, 5);
  // differentials: mini-league differential score (spec §6)
  const youIds = youS.idsSet;
  const diffs = DATA.players
    .filter(p => p.status === 'a' && p.mins >= 60 && !youIds.has(p.id))
    .map(p => {
      const owned = R.filter(rv => rv.s.idsSet.has(p.id)).length;
      const gapFrac = 1 - owned / n; // opponent exposure gap
      const score = ((p.ep_next || 0) * 1.5 + (p.form || 0) * 0.8 + (3 - adjAvg3(p)) * 1.5 + ownForm(p) * 1.2) * (0.5 + gapFrac);
      return { p, owned, score };
    })
    .sort((a, b) => b.score - a.score).slice(0, 5);
  // captain engine (spec §10): safe / balanced / differential
  const capCands = youS.start.filter(x => x.e).map(x => {
    const na = ((window.TF[x.tShort] || {}).afx || [3])[0];
    return { x, c: x.ep * (FM[Math.max(1, Math.min(5, Math.round(na)))] || 1) * (0.9 + 0.1 * ownForm({ team: x.tShort })) };
  }).sort((a, b) => b.c - a.c).slice(0, 4);
  capCands.forEach(cc => { cc.rivCap = R.filter(rv => rv.s.cap && rv.s.cap.id === cc.x.id).length; cc.cls = cc.rivCap >= 2 ? 'SAFE' : cc.rivCap === 1 ? 'BALANCED' : 'DIFFERENTIAL'; });
  const capPick = mode === 'DEFEND' ? capCands.find(c => c.cls === 'SAFE') || capCands[0]
    : mode === 'CONSOLIDATE' ? capCands.find(c => c.cls !== 'DIFFERENTIAL') || capCands[0]
      : mode === 'ATTACK' ? (capCands.find(c => c.cls === 'DIFFERENTIAL' && c.x.ep >= 4) || capCands[0])
        : (capCands.slice(1).find(c => c.cls === 'DIFFERENTIAL') || capCands[0]);
  // transfer + hit verdict (spec §8-9)
  const weakest = youS.start.slice().sort((a, b) => a.ep - b.ep)[0];
  const funds = (window.TEAMCTX ? window.TEAMCTX.maxFund : 100);
  const tgt = DATA.players
    .filter(p => p.status === 'a' && p.mins >= 60 && !youIds.has(p.id) && p.cost <= funds)
    .map(p => ({ p, owned: R.filter(rv => rv.s.idsSet.has(p.id)).length }))
    .sort((a, b) => (b.p.ep_next + ownForm(b.p)) - (a.p.ep_next + ownForm(a.p)))[0];
  const gain = tgt && weakest ? (tgt.p.ep_next || 0) - (weakest.ep || 0) : 0;
  const hitYes = !!tgt && gain * Math.min(gwsLeft, 4) > 4 && mode !== 'DEFEND' && (1 - (tgt.owned / n)) >= 0.5;
  const hitText = tgt ? (hitYes
    ? `YES (mode ${mode}): ${esc(tgt.p.name)} over ${weakest.e ? weakest.e.n : 'weakest starter'} ≈ +${gain.toFixed(1)}/GW × ${Math.min(gwsLeft, 4)} GWs > 4-pt hit, and ${tgt.owned}/${n} rivals own him.`
    : `NO — expected gain +${gain.toFixed(1)}/GW doesn't clear the -4 in ${mode} mode${tgt.owned / n >= 0.5 ? ', and rivals already own him (no edge)' : ''}. Save the transfer.`) : 'No affordable upgrade found.';
  // chip battle vs primary rival (spec §12)
  const prim = R[0];
  // ---- Win probability: REAL weekly volatility per manager, season-long sim ----
  const youVol = mlVol(youData.gwPts);                       // your real weekly σ (official history)
  const rvVols = R.map(rv => ({ rv, vol: mlVol(rv.gwPts) }));// each rival's real weekly σ
  const sim = mlSimulate(
    { total: you.total, mu: youS.mu, sd: youVol.sd },
    rvVols.map(v => ({ total: v.rv.row.total, mu: v.rv.s.mu, sd: v.vol.sd })),
    ML_PLANS, { sims: 2400, gws: gwsLeft }
  );
  const probs = { Safe: sim.Safe.winPct, Balanced: sim.Balanced.winPct, Aggressive: sim.Aggressive.winPct };
  const bestProb = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
  const mainRiv = rvVols[0] || null;

  Object.assign(ML, {
    ready: true, you, youS, R, leader, gap, catchRate, gwsLeft, mode, modeTxt, n,
    threats, diffs, capCands, capPick, tgt, gain, hitText, probs, prim,
    youChips, sorted, sim, youVol, rvVols,
    ownCount: p => R.filter(rv => rv.s.idsSet.has(p.id)).length,
    capLens: s => {
      const cc = capCands.find(c => c.x.id === ((s.r && s.r.element) || s.id));
      if (!cc) return '';
      return `<span class="capclass cap-${cc.cls}">${cc.cls}</span> <span class="tk-opp">captained by ${cc.rivCap}/${n} rivals</span>`;
    },
  });

  // ---------- render ----------
  const tiles = (v, k) => `<div class="tstat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  $('#mlCmd').innerHTML = `<div class="card"><h2>🎯 Command Center — GW${mlGw()}</h2>
    <div class="team-stats">
      ${tiles('#' + you.rank, 'League rank')}${tiles(you.total, 'Your points')}
      ${tiles(esc(leader.entry_name), leader.id === youId ? 'Leader (you!)' : 'Leader')}
      ${tiles((gap > 0 ? '-' : '+') + Math.abs(gap), 'Gap to leader')}
      ${tiles(gwsLeft, 'GWs left')}${tiles('~' + catchRate.toFixed(1), 'pts/GW needed')}
    </div>
    <p style="margin:10px 0 4px"><span class="mode-badge mode-${mode === 'ALLIN' ? 'ALLIN' : mode}">${mode === 'ALLIN' ? 'ALL-IN' : mode}</span>
    <span class="muted" style="margin-left:10px">${modeTxt}</span></p>
    <p class="muted">Win-probability simulator (per-manager volatility from real GW history · model estimate):</p>
    <p style="margin:4px 0">${ML_PLANS.map(pl => `<span class="capclass cap-${pl.key === 'Safe' ? 'SAFE' : pl.key === 'Balanced' ? 'BALANCED' : 'DIFFERENTIAL'}">${pl.key}</span> <b>${sim[pl.key].winPct}%</b> win league <span class="muted">· final pts ${sim[pl.key].p10}–${sim[pl.key].p90} (mid ${sim[pl.key].med})</span>`).join('<br>')}</p>
    <p class="muted">Engine recommends <b>${bestProb[0]}</b> (${ML_PLANS.find(p => p.key === bestProb[0]).why}). Volatility fed from each team's real weekly scores: you σ≈${youVol.sd.toFixed(1)}${youVol.n ? ` from ${youVol.n} GW${youVol.n > 1 ? 's' : ''}` : ' (no history yet)'}${mainRiv && mainRiv.vol.n ? ` · ${esc(mainRiv.rv.row.entry_name)} σ≈${mainRiv.vol.sd.toFixed(1)} from ${mainRiv.vol.n} GWs` : ''}. Chips & fixture swings not modelled — directional, never a promise.</p>
  </div>`;

  const weak = rv => {
    const w = [];
    if (rv.s.avgAdj3 >= 3.2) w.push(`tough fixtures (adj FDR ${rv.s.avgAdj3.toFixed(1)})`);
    if (rv.s.flagged) w.push(`${rv.s.flagged} flagged player${rv.s.flagged > 1 ? 's' : ''}`);
    if (rv.s.clubMax >= 4) w.push(`over-invested in one club (${rv.s.clubMax})`);
    if (rv.s.benchEp <= 6) w.push('weak bench');
    if (!rv.s.start.some(x => ((window.TF[x.tShort] || {}).rank || 99) <= 3)) w.push('no exposure to top-3 form teams');
    if (youChips.length > rv.chips.length) w.push('fewer chips left than you');
    return w.length ? w.join(' · ') : 'no obvious weakness — win on captaincy';
  };
  $('#mlBeat').innerHTML = you.rank === 1 ? `<div class="card"><h2>🛡️ Defend My Lead</h2>
    <p>Nearest chaser: <b>${esc((sorted[1] || {}).entry_name || '—')}</b>, ${(you.total - (sorted[1] || { total: you.total }).total)} pts behind.</p>
    <p class="muted">Threat players (owned by chasers, not you): ${threats.map(t => `<b>${esc(t.e.n)}</b> (${t.c}/${n})`).join(', ') || 'none — your differentials are working'}.</p>
    <p class="muted">Match their captain when ${capCands[0] ? esc(capCands[0].x.e.n) + ' is the field-safe pick' : 'the safe pick scores highest'}; stay template-heavy; only chase differentials your chasers can't copy in one transfer.</p>
  </div>` : `<div class="card"><h2>⚔️ How To Beat ${esc(leader.entry_name)}</h2>
    <p>Gap <b>${gap}</b> pts over <b>${gwsLeft}</b> GWs → need ≈ <b>${catchRate.toFixed(1)}</b> pts/GW edge. Leader's XI: ${R[0] ? R[0].s.startNames.slice(0, 6).map(esc).join(', ') + '…' : '—'}</p>
    <p class="muted">Leader's weakness: ${R[0] ? weak(R[0]) : '—'}. Your edge: ${diffs[0] ? `<b>${esc(diffs[0].p.name)}</b> (${diffs[0].p.own}% owned, ${diffs[0].owned}/${n} rivals have him)` : '—'}.</p>
  </div>`;

  $('#mlChips').innerHTML = prim ? `<div class="card"><h2>🃏 Chip Battle vs ${esc(prim.row.entry_name)}</h2>
    <table class="data"><tr><th>Chip</th><th>You</th><th>Them</th><th>Advantage</th></tr>
    ${ALL_CHIPS.map(([k, l]) => {
    const u = !youChips.includes(k), o = !prim.chips.includes(k);
    return `<tr><td>${l}</td><td>${u ? '✅' : '❌'}</td><td>${o ? '✅' : '❌'}</td><td>${u && !o ? '<b class="up">You</b>' : !u && o ? '<b class="down">Them</b>' : 'Neutral'}</td></tr>`;
  }).join('')}</table>
    <p class="muted">${youChips.includes('3xc') && prim.chips.includes('3xc') ? 'Both hold Triple Captain — save it for a GW where your captain is a differential.' : youChips.includes('3xc') && !prim.chips.includes('3xc') ? 'You hold TC and they don\'t — a strategic weapon: use it on a differential captain week.' : 'Chip parity — timing, not stock, will decide it.'}</p>
  </div>` : '';

  $('#mlRivals').innerHTML = `<div class="card"><h2>🕵️ Relevant Rivals (relative analysis)</h2><p class="muted">Lineups = latest published picks; rival captains for GW${mlGw() + 1} are unknowable until deadline, so captaincy threats reflect their latest choice.</p><div class="ml-grid">
    ${R.map(rv => `<div class="ml-rival"><h4>${esc(rv.row.entry_name)} <span class="muted">#${rv.row.rank}</span></h4>
      <div class="gapline">${rv.row.total - you.total >= 0 ? '+' : ''}${rv.row.total - you.total} pts vs you · GW${mlGw() - 1}: ${rv.row.event_total ?? '—'} · cap: <b>${rv.s.cap && rv.s.cap.e ? esc(rv.s.cap.e.n) : '—'}</b></div>
      <div class="gapline">Shared ${rv.shared} · theirs-only ${rv.onlyThem.length} · yours-only ${rv.onlyYou.length}</div>
      <div class="gapline">Beat them via: ${weak(rv)}</div>
    </div>`).join('')}
  </div></div>`;

  const capField = capCands.slice().sort((a,b)=>(b.rivCap||0)-(a.rivCap||0)||(b.x.ep||0)-(a.x.ep||0))[0] || null;
  const capFieldPP = capField ? ppOfId(capField.x.id) : null;
  // v30 single forecast brain: model xP when the player is in the catalog, else official ep
  const ccXpOf = cc => { const f = (typeof fcOfId === 'function') ? fcOfId(cc.x.id) : null; return f ? f.xp : cc.x.ep; };
  const levFor = cc => {
    if (!capField) return '';
    if (cc === capField || cc.x.id === capField.x.id) return ' <span class="xb" style="--c:var(--amber)">field</span>';
    const cf = (typeof fcOfId === 'function') ? fcOfId(cc.x.id) : null;
    return '<br>' + capLevLine({ name: cc.x.e.n, ep: ccXpOf(cc), p6: cf ? cf.p6 : (ppOfId(cc.x.id) || {}).p6, p10: cf ? cf.p10 : (ppOfId(cc.x.id) || {}).p10 },
      { name: capField.x.e.n, ep: ccXpOf(capField), p6: capFieldPP && capFieldPP.p6, p10: capFieldPP && capFieldPP.p10 });
  };
  $('#mlCap').innerHTML = `<div class="card"><h2>👑 Captaincy — ML lens</h2>
    ${capCands.map((cc, i) => `<span class="mrow">${i + 1}. <b>${esc(cc.x.e.n)}</b> xP ${ccXpOf(cc).toFixed(1)} <span class="capclass cap-${cc.cls}">${cc.cls}</span> <span class="tk-opp">${cc.rivCap}/${n} rivals captain him</span>${levFor(cc)}</span><br>`).join('')}
    <p style="margin-top:6px">⚖️ Field captain = what most of your rivals currently captain (latest picks — may change at deadline). Engine pick for <b>${mode}</b> mode: <b>${esc(capPick.x.e.n)}</b> — ${capPick.cls === 'SAFE' ? 'matching the field protects your position.' : capPick.cls === 'BALANCED' ? 'solid points with a slight edge over some rivals.' : 'the upside edge your gap requires; rivals won\'t match it.'}</p>
    <p class="muted" style="margin-top:4px">Leverage = expected-pts edge of your captain vs the field's, plus haul-chance edge. +ve means you are expected to beat the field by that many pts this GW — model estimate, single-GW, not a promise.</p>
  </div>`;

  $('#mlDiff').innerHTML = `<div class="card"><h2>💎 Mini-League Differentials & ⚠️ Threats</h2>
    ${diffs.map(d => `<span class="mrow">• <b>${esc(d.p.name)}</b> (${d.p.team}, ${d.p.own}% owned, <b>${d.owned}/${n} rivals</b>) — ep ${d.p.ep_next}, adj FDR ${adjAvg3(d.p).toFixed(1)}, ML-score ${d.score.toFixed(1)}</span><br>`).join('')}
    <p class="muted" style="margin-top:6px">Threats (haul = you lose ground): ${threats.map(t => `<b>${esc(t.e.n)}</b> (${t.c}/${n} rivals, not you)`).join(' · ') || 'none significant'}. ${mode === 'DEFEND' ? 'In DEFEND mode, consider matching the biggest threat.' : 'Differentials above are how you swing points they can\'t copy.'}</p>
  </div>`;

  $('#mlMove').innerHTML = `<div class="card"><h2>🔄 Transfer & Hit Verdict</h2>
    <p>${tgt ? `Best ML transfer: <b>${weakest && weakest.e ? esc(weakest.e.n) : '—'} → ${esc(tgt.p.name)}</b> (+${gain.toFixed(1)} ep/GW, ${tgt.owned}/${n} rivals own him, adj FDR ${adjAvg3(tgt.p).toFixed(1)}).` : 'No transfer beats standing pat this week.'}</p>
    <p>🚨 Hit? <b>${hitYes ? 'YES' : 'NO'}</b> — ${hitText}</p>
  </div>`;

  const riskEm = { DEFEND: '🟢 low', CONSOLIDATE: '🟡 medium', ATTACK: '🟠 high', ALLIN: '🔴 extreme' }[mode];
  $('#mlRoad').innerHTML = `<div class="card"><h2>🗺️ GW Roadmap (updates weekly)</h2>
    ${[0, 1, 2].map(i => {
      const g = curGw + 1 + i;
      const obj = i === 0 ? `Close ~${Math.min(Math.max(1, Math.round(catchRate)), 6)} pts of the gap` : i === 1 ? (mode === 'DEFEND' ? 'Maintain lead, avoid swings' : 'Keep pressure on') : 'Re-assess after deadline — plan is dynamic';
      return `<span class="mrow"><b>GW${g}</b> — ${obj} · captain style: <span class="capclass cap-${i === 2 ? 'BALANCED' : capPick.cls}">${i === 2 ? 'TBD' : capPick.cls}</span> · risk ${riskEm}${i === 1 && mode !== 'DEFEND' && youChips.length ? ' · chip candidate if fixtures align' : ''}</span><br>`;
    }).join('')}
    <p class="muted">The roadmap re-computes every gameweek from fresh data — never treat it as a promise.</p>
  </div>`;

  $('#mlStatus').textContent = `Ready — studying ${R.length} relevant rivals around #${you.rank}.`;
}
$('#mlLoad').onclick = mlLoadLeague;

function mlSummary() {
  if (!ML.ready) return 'Open the 🏆 Mini League tab and load your league ID first — then every answer here factors your rivals.';
  const m = ML;
  return `🏆 <b>Mini League:</b> you're #${m.you.rank}, ${m.gap} pts off ${esc(m.leader.entry_name)} with ${m.gwsLeft} GWs left (~${m.catchRate.toFixed(1)}/GW needed) → mode <b>${m.mode}</b>.<br>
  <span class="mrow">👑 Captain: <b>${esc(m.capPick.x.e.n)}</b> (${m.capPick.cls}).</span><br>
  <span class="mrow">🔄 Move: ${m.tgt ? `${m.tgt.p.name} in (${m.gain >= 0 ? '+' : ''}${m.gain.toFixed(1)}/GW, ${m.tgt.owned}/${m.n} rivals own)` : 'hold'} · Hit: ${m.hitText.startsWith('YES') ? 'YES' : 'NO'}.</span><br>
  <span class="mrow">💎 Differential: ${m.diffs[0] ? `${m.diffs[0].p.name} (${m.diffs[0].owned}/${m.n} rivals)` : '—'} · Win prob ≈ ${m.probs.Safe}/${m.probs.Balanced}/${m.probs.Aggressive}% (safe/bal/agg).</span>`;
}

// ============ 📅 PRO SUITE: projections · multi-GW solver · chips · compare · sparklines ============
// Reliability: punishes one-week wonders (form spike vs season avg) and rewards real underlying output (xGI/90).
const REL_MEMO = {};
function reliab(p) {
  if (REL_MEMO[p.id] != null) return REL_MEMO[p.id];
  const h = (DATA.history || {})[p.id] || [];
  let r = 0.7;
  if (h.length) {
    let mins = 0, xgi = 0, pts = 0, mx = 0;
    h.forEach(x => { mins += x[4]; xgi += x[2] + x[3]; pts += x[1]; mx = Math.max(mx, x[1]); });
    const per90 = mins >= 60 ? (xgi / mins) * 90 : 0;
    const xgiTerm = Math.min(1, per90 / 0.7);
    const minsTerm = Math.min(1, mins / 270);
    const levelTerm = Math.min(1, (pts / h.length) / 6);
    // GK/DEF earn via clean sheets & defensive work, not xGI — weight minutes + level instead
    r = (p.pos === 'GK' || p.pos === 'DEF')
      ? 0.20 * xgiTerm + 0.40 * minsTerm + 0.40 * levelTerm
      : 0.45 * xgiTerm + 0.35 * minsTerm + 0.20 * levelTerm;
    // one-week-wonder penalty: season total concentrated in ONE gameweek AND underlying xGI doesn't back it
    if (pts > 0 && h.length >= 2) {
      const conc = mx / pts;
      r *= 1 - 0.45 * Math.max(0, conc - 0.6) / 0.4 * (1 - xgiTerm);
    }
    r = Math.max(0.25, Math.min(1, r));
  }
  REL_MEMO[p.id] = r;
  return r;
}

// ---- Selection / minutes model (audit roadmap #6) ----
// Estimates P(player starts next GW) from REAL evidence: his actual per-GW
// starts this season (GW rows with >=60 mins = a start) blended with minutes,
// gated by his official status. Replaces the crude 0.5+0.5*(mins/270) guess
// that treated a 270-min lock and a rotation-risk defender too alike.
const SEL_MEMO = {};
function selState(p) {
  const rows = (DATA.history || {})[p.id] || [];
  let n = 0, starts = 0, mins = 0;
  rows.forEach(r => { n++; mins += r[4] || 0; if ((r[4] || 0) >= 60) starts++; });
  return { n, starts, mins };
}
function startProb(p, over) {
  const mins = over && over.mins != null ? over.mins : (p.mins || 0);
  const status = over && over.status != null ? over.status : (p.status || 'a');
  const key = p.id + '|' + mins + '|' + status;
  if (SEL_MEMO[key] != null) return SEL_MEMO[key];
  const statusBase = (status === 'i' || status === 's') ? 0.05 : status === 'd' ? 0.4 : status === 'u' ? 0.6 : 1;
  const { n, starts } = selState(p);
  const startFrac = n ? starts / n : 0;
  const w = n / (n + 1.5); // trust the real start record more each GW
  const fallback = mins >= 240 ? 0.95 : mins >= 180 ? 0.8 : mins >= 90 ? 0.6 : mins > 0 ? 0.4 : 0.2;
  const evidence = w * startFrac + (1 - w) * fallback;
  const pStart = Math.min(0.97, Math.max(0.02, statusBase * (0.3 + 0.7 * evidence)));
  SEL_MEMO[key] = pStart;
  return pStart;
}
function selLabel(pStart) {
  if (pStart >= 0.9) return { txt: 'nailed-on', c: 'var(--green)' };
  if (pStart >= 0.7) return { txt: 'high minutes', c: 'var(--green)' };
  if (pStart >= 0.5) return { txt: 'rotation risk', c: 'var(--amber)' };
  if (pStart >= 0.3) return { txt: 'bench risk', c: 'var(--red)' };
  return { txt: 'fringe', c: 'var(--red)' };
}
function selLine(p) {
  const ps = startProb(p);
  const l = selLabel(ps);
  return '<div style="display:flex;justify-content:space-between"><span class="muted" title="model: his real GW1-' + ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + ' starts + official status">starts (selection model)</span><b style="color:' + l.c + '">~' + Math.round(ps * 100) + '% · ' + l.txt + '</b></div>';
}

// ============ 🎯 FIXTURE-RESPONSE MODEL (audit B2/M2 · v31) ============
// The one-spine fix: previously the xP moved with the fixture but P(>=6)/P(>=10)
// did not (they never saw the opponent). Now BOTH respond to the same fitted,
// REAL-data opponent strength. Defenders/GK respond to the opponent's ATTACK
// (xG per match — CS odds), attackers/MID to the opponent's DEFENCE (xGA per
// match). Ratios of observed GW1-3 points & return-rates vs the league mean are
// shrunk hard (small sample) — labelled model estimates, never a promise.
const FIX_MEMO = {};
function fixCalib() {
  if (FIX_MEMO.ready) return FIX_MEMO;
  const res = { att: null, def: null, mean: null, n: 0, note: '' };
  try {
    if (!DATA.results || !DATA.results.length || !DATA.history || !DATA.players) return res;
    const byTeam = {};
    (DATA.results || []).forEach(m => {
      [['home', m.hxg, m.axg], ['away', m.axg, m.hxg]].forEach(([side, xgf, xga]) => {
        const o = byTeam[m[side]] = byTeam[m[side]] || { n: 0, xgf: 0, xga: 0 };
        o.n++; o.xgf += xgf || 0; o.xga += xga || 0;
      });
    });
    const teams = Object.keys(byTeam);
    if (!teams.length) return res;
    const meanOf = k => teams.reduce((a, t) => a + byTeam[t][k] / byTeam[t].n, 0) / teams.length;
    const meanXgf = meanOf('xgf'), meanXga = meanOf('xga');
    const gwOpp = {};
    (DATA.results || []).forEach(m => {
      (gwOpp[m.gw] = gwOpp[m.gw] || {})[m.home] = m.away;
      (gwOpp[m.gw] = gwOpp[m.gw] || {})[m.away] = m.home;
    });
    const byId = {}; (DATA.players || []).forEach(p => { byId[p.id] = p; });
    // pools measure RELATIVE response: ratio of band stats to the pool's own mean
    const mk = () => ({ band: [{ n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }, { n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }, { n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }], n: 0, sum: 0, r6: 0 });
    const att = mk(), def = mk();
    const bandOf = rel => rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
    // v36: track the mean relative strength of each band so the fitted factors can
    // be interpolated SMOOTHLY instead of applied as 3 hard steps (the step was why
    // Hull(H), Brentford(A) and Bournemouth(H) all got the identical multiplier).
    const push = (pool, b, pts, rel) => {
      pool.n++; pool.sum += pts; if (pts >= 6) pool.r6++;
      pool.band[b].n++; pool.band[b].sum += pts; if (pts >= 6) pool.band[b].r6++;
      if (rel != null && isFinite(rel)) { pool.band[b].rSum += rel; pool.band[b].rN++; }
    };
    for (const idStr of Object.keys(DATA.history)) {
      const pl = byId[+idStr]; if (!pl || !pl.team) continue;
      const pool = (pl.pos === 'GK' || pl.pos === 'DEF') ? def : att;
      const teamRow = byTeam[pl.team]; if (!teamRow) continue;
      for (const r of DATA.history[idStr] || []) {
        if ((r[4] || 0) < 60) continue;                     // starters only (best "actually plays" proxy)
        const g = r[0], opp = (gwOpp[g] || {})[pl.team];
        const op = opp && byTeam[opp]; if (!op) continue;
        // lens: attacker faces opp defence (xga); defender faces opp attack (xgf)
        const rel = (pl.pos === 'GK' || pl.pos === 'DEF')
          ? meanXgf / Math.max(0.05, op.xgf / op.n)          // >1 => opp attack weak => easier
          : (op.xga / op.n) / meanXga;                       // >1 => opp defence leaky => easier
        push(pool, bandOf(rel), r[1] || 0, rel);
      }
    }
    const fit = (pool, K) => {
      const totPts = pool.n ? pool.sum / pool.n : 0;
      const tot6 = pool.n ? pool.r6 / pool.n : 0;
      const DEF_C = [0.7, 1, 1.35];   // fallback centres (rel<0.86 / <=1.16 / else)
      const bands = pool.band.map((b, bi) => {
        const n = b.n;
        let xf = 1, pf = 1;
        if (n && totPts > 0) {
          const w = n / (n + K);
          xf = Math.max(0.6, Math.min(1.55, 1 + w * ((b.sum / n) / totPts - 1)));
        }
        if (n && tot6 > 0) {
          const w = n / (n + K);
          pf = Math.max(0.55, Math.min(1.8, 1 + w * ((b.r6 / n) / tot6 - 1)));
        }
        const c = b.rN ? b.rSum / b.rN : DEF_C[bi];
        return { n, xf: Math.round(xf * 1000) / 1000, pf: Math.round(pf * 1000) / 1000, c: Math.round(c * 1000) / 1000, cN: b.rN };
      });
      return { bands, n: pool.n, bounds: [0.86, 1.16] };
    };
    res.att = fit(att, 12); res.def = fit(def, 12);
    res.mean = { meanXgf: Math.round(meanXgf * 1000) / 1000, meanXga: Math.round(meanXga * 1000) / 1000 };
    res.n = att.n + def.n;
  } catch (e) { console.error('[fixCalib]', e); }
  FIX_MEMO.ready = true; FIX_MEMO.att = res.att; FIX_MEMO.def = res.def; FIX_MEMO.mean = res.mean; FIX_MEMO.n = res.n; FIX_MEMO.note = res.note;
  return FIX_MEMO;
}
// per-player fixture response for GW index i (default 0 = next GW). Returns
// {xf,pf,band,opp} or null when the opponent isn't known / no data yet.
// ---- v36 SMOOTH FIXTURE GRADING -------------------------------------------------
// The old model bucketed every opponent into TOUGH / NEUTRAL / EASY and applied ONE
// fitted multiplier per bucket, so three different opponents in the same bucket were
// indistinguishable (Hull(H), Brentford(A) and Bournemouth(H) all got x0.94) and a
// fixture the app paints green could be penalised. fixSmooth interpolates between the
// FITTED band anchors, so relative strength moves the multiplier continuously.
function fixSmooth(bands, rel, key) {
  if (!bands || !bands.length || rel == null || !isFinite(rel)) return 1;
  const k = key || 'xf';
  const cs = bands.map(b => (b.c == null ? NaN : b.c));
  const ok = cs.every(x => isFinite(x)) && cs.every((x, i) => i === 0 || x > cs[i - 1]);
  if (!ok) {                                  // noisy/degenerate centres -> safe step fallback
    const b = rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
    return (bands[b] && bands[b][k] != null) ? bands[b][k] : 1;
  }
  if (rel <= cs[0]) return bands[0][k];
  const last = cs.length - 1;
  if (rel >= cs[last]) return bands[last][k];
  for (let i = 1; i <= last; i++) {
    if (rel <= cs[i]) {
      const t = (rel - cs[i - 1]) / Math.max(1e-6, cs[i] - cs[i - 1]);
      const v = bands[i - 1][k] + t * (bands[i][k] - bands[i - 1][k]);
      return Math.round(v * 1000) / 1000;
    }
  }
  return bands[last][k];
}
// ONE fixture voice for the whole app: the opponent-calibration multiplier (smooth)
// blended GEOMETRICALLY with the adjusted difficulty the app DISPLAYS on the fixture
// map / ticker (afx -> 1.15 / 1.08 / 1.00 / 0.92 / 0.85). Because both the points
// estimate and the return probabilities read this single object, a green fixture can
// no longer boost one surface while penalising another.
// the displayed adjusted-difficulty -> multiplier table (identical to FM; kept as a
// named lookup so this module also works in the isolated regression slices that do
// not carry FM, and so the two can never silently drift apart)
function fdrMultOf(afdr) {
  const M = (typeof FM !== 'undefined' && FM && FM[3] === 1) ? FM : { 1: 1.15, 2: 1.08, 3: 1, 4: 0.92, 5: 0.85 };
  return M[afdr] || 1;
}
function fixtureFactor(p, i) {
  const f = (p && p.next3) ? (p.next3[i == null ? 0 : i] || null) : null;
  const cal = oppFixOf(p, i);
  const afdrRaw = f ? (f.afdr != null ? f.afdr : (f.adjv != null ? Math.round(f.adjv) : f.fdr)) : null;
  const afdr = (afdrRaw == null) ? null : Math.max(1, Math.min(5, Math.round(afdrRaw)));
  const drM = (afdr == null) ? null : fdrMultOf(afdr);
  if (!cal) return null;
  const xf = drM == null ? cal.xf : Math.sqrt(cal.xf * drM);
  const pf = drM == null ? cal.pf : Math.sqrt(cal.pf * drM);
  return {
    xf: Math.round(Math.max(0.6, Math.min(1.6, xf)) * 1000) / 1000,
    pf: Math.round(Math.max(0.5, Math.min(1.8, pf)) * 1000) / 1000,
    band: cal.band, opp: cal.opp, rel: cal.rel, afdr, calXf: cal.xf, calPf: cal.pf,
    src: drM == null ? 'calibration' : 'calibration+displayed-fdr',
  };
}
function oppFixOf(p, i) {
  if (!p) return null;
  const ix = i == null ? 0 : i;
  const f = (p.next3 || [])[ix] || null;
  const opp = f ? f.opp : null;
  if (!opp) return null;
  const cal = fixCalib();
  if (!cal.att) return null;
  const isDef = p.pos === 'GK' || p.pos === 'DEF';
  const team = (typeof osmByShort === 'function') ? osmByShort()[opp] : null;
  if (!team || !cal.mean) return null;
  // higher rel == easier for this position (attacker: leaky opp defence; defender: weak opp attack)
  const rel = isDef ? cal.mean.meanXgf / Math.max(0.05, team.att) : team.xga / cal.mean.meanXga;
  const b = rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
  const tab = isDef ? cal.def : cal.att;
  const blk = tab.bands[b];
  const xf = fixSmooth(tab.bands, rel, 'xf');
  const pf = fixSmooth(tab.bands, rel, 'pf');
  return { xf, pf, band: ['tough', 'neutral', 'easy'][b], opp, n: blk.n,
    bandXf: blk.xf, bandPf: blk.pf,          // the old step value (kept for the before/after diff)
    rel: Math.round(rel * 1000) / 1000, mode: 'smooth' };
}

// per-GW model projection: blend(official ep, form) × form-adjusted FDR × H/A × minutes × reliability
const projP = (p, i) => {
  const t = window.TF[p.team] || {};
  const a = (t.afx || [3, 3, 3, 3, 3, 3, 3])[i] ?? 3;
  const f = (p.next3 || [])[i] || null;
  const ha = f ? f.ha : null;
  const minProb = startProb(p);
  const base = 0.55 * (p.ep_next || 0) + 0.45 * (p.form || 0);
  const fx = (typeof fixtureFactor === 'function') ? fixtureFactor(p, i) : oppFixOf(p, i);
  const mult = fx ? fx.xf : (FM[Math.max(1, Math.min(5, Math.round(a)))] || 1);
  return base * mult * (ha === 'H' ? 1.06 : ha === 'A' ? 0.94 : 1) * minProb * (0.6 + 0.4 * reliab(p));
};
const hSumP = (p, H) => { let s = 0; for (let i = 0; i < H; i++) s += projP(p, i); return s; };

// ============ 👟 MINUTES V2 (v2.0 Phase 2) — selection & minutes ladder ============
// minutesV2(p) — NOT wired into production forecasts yet. Built beside the legacy
// startProb()/minutesOf() engine for A/B comparison (v2.0 audit, Phase 2). It uses
// ONLY pre-deadline evidence: GW1-N minute history, official status, official
// chance_next and the public news line. Returns the audit-required ladder:
//   { pStart, p60, p75, p90, expectedMinutes,
//     confidence: { overall, data, minutes, availability }, evidence: [...] }
// Design notes:
//   * start rate: Beta-Binomial shrinkage with a PERSONAL prior — the pool start
//     rate lifted by how completely he plays when on the pitch (a guy playing
//     75'+ every week is not a rotation piece), recency-weighted (0.85^age).
//   * minute depth among starts: his real ≥60/≥75/≥90 shares, shrunk to position
//     priors — so P(90) < P(75) < P(60) <= P(start) always holds.
//   * availability gate: official status + official chance_next (a 75% doubt is
//     more informative than the status letter alone) + suspension news.
//   * confidence: data (sample size), minutes (variability), availability.
const V2M_MEMO = {};
function v2mPriors() {
  if (V2M_MEMO._pri) return V2M_MEMO._pri;
  const H = DATA.history || {}, P = DATA.players || [];
  const acc = {};
  P.forEach(pl => {
    const a = acc[pl.pos] = acc[pl.pos] ||
      { rows: 0, starts: 0, m60: 0, m75: 0, m90: 0, stMin: 0, stN: 0, camN: 0, camMin: 0, nonStart: 0, nonStartPlayed: 0 };
    (H[pl.id] || []).forEach(r => {
      const m = r[4] || 0;
      a.rows++;
      if (m >= 60) { a.starts++; a.stN++; a.stMin += m; if (m >= 60) a.m60++; if (m >= 75) a.m75++; if (m >= 90) a.m90++; }
      else { a.nonStart++; if (m > 0) { a.nonStartPlayed++; a.camN++; a.camMin += m; } }
    });
  });
  const pri = { _def: { startRate: .55, d60: .93, d75: .8, d90: .55, minsPerStart: 80, cameoAvg: 22, playNotStart: .4 } };
  Object.keys(acc).forEach(pos => {
    const a = acc[pos];
    pri[pos] = {
      startRate: a.rows ? a.starts / a.rows : .55,
      d60: a.starts ? a.m60 / a.starts : .93,
      d75: a.starts ? a.m75 / a.starts : .8,
      d90: a.starts ? a.m90 / a.starts : .55,
      minsPerStart: a.stN ? a.stMin / a.stN : 80,
      cameoAvg: a.camN ? a.camMin / a.camN : 22,
      playNotStart: a.nonStart ? a.nonStartPlayed / a.nonStart : .4,
      n: a.rows,
    };
  });
  V2M_MEMO._pri = pri;
  return pri;
}
function minutesV2(p) {
  const ch = (typeof p.chance_next === 'number' && p.chance_next < 100) ? p.chance_next : null;
  const key = 'v2|' + p.id + '|' + (p.mins || 0) + '|' + p.status + '|' + (ch == null ? '' : ch);
  if (V2M_MEMO[key]) return V2M_MEMO[key];
  const pri = v2mPriors(), A = pri[p.pos] || pri._def;
  const rows = ((DATA.history || {})[p.id] || []).map(r => ({ gw: r[0] || 0, m: r[4] || 0 }));
  const latest = rows.length ? Math.max.apply(null, rows.map(r => r.gw)) : 0;
  const news = String(p.news || '');
  const ev = [];

  // ---- availability gate (official pre-deadline signals only) ----
  const st = p.status || 'a';
  let avail = 1;
  if (st === 's' || /susp/i.test(news)) { avail = 0.05; ev.push('suspended' + (news ? ' — ' + news : '')); }
  else if (st === 'i') { avail = 0.05; ev.push('injured' + (news ? ' — ' + news : '') + (ch != null ? ' · official ' + ch + '% to play' : '')); }
  else if (st === 'u') { avail = 0.5; ev.push('unavailable per official status'); }
  else if (ch != null) { avail = 0.05 + 0.9 * ch / 100; ev.push('official ' + ch + '% chance to play' + (news ? ' (' + news + ')' : '')); }
  else if (st === 'd') { avail = 0.65; ev.push('doubtful per official status' + (news ? ' — ' + news : '')); }

  // ---- recency-weighted start rate with a personal prior ----
  let S = 0, W = 0, comp = 0;
  rows.forEach(r => { const w = Math.pow(0.85, latest - r.gw); W += w; if (r.m >= 60) S += w; if (r.m >= 75) comp += w; });
  const compShare = W ? comp / W : 0;
  const bP = Math.min(0.93, A.startRate + 0.45 * compShare);   // personal prior from minute completeness
  const K = 0.7;                                                 // prior strength (~0.7 GW of evidence)
  const pStartRaw = W > 0 ? (S + K * bP) / (W + K) : bP;
  if (rows.length) {
    const starts = rows.filter(r => r.m >= 60).length;
    ev.push(starts + '/' + rows.length + ' starts (GW' + rows[0].gw + '-' + latest + ', recency-weighted ' + (W ? Math.round(100 * S / W) : 0) + '%)');
    if (compShare >= 0.9 && starts >= 2) ev.push('plays 75+ whenever selected — role security');
  } else ev.push('no GW history yet — position prior applied (start base ' + Math.round(A.startRate * 100) + '%)');

  // ---- minute-depth ladder among his starts, shrunk to position priors ----
  const stRows = rows.filter(r => r.m >= 60), n = stRows.length;
  const depth = (thr, prior) => Math.min(1, (stRows.filter(r => r.m >= thr).length + prior) / (n + 1));
  const d90 = depth(90, A.d90), d75 = Math.max(d90, Math.min(1, depth(75, A.d75))), d60 = Math.max(d75, Math.min(1, depth(60, A.d60)));

  // ---- minutes when involved: starts shrunk to prior, cameos from his own record ----
  const stAvg = n ? stRows.reduce((s, r) => s + r.m, 0) / n : A.minsPerStart;
  const minsPerStart = (n * stAvg + 1 * A.minsPerStart) / (n + 1);   // shrunk toward the position prior
  const camRows = rows.filter(r => r.m > 0 && r.m < 60);
  const cameoAvg = camRows.length ? camRows.reduce((s, r) => s + r.m, 0) / camRows.length : A.cameoAvg;
  const nonStart = rows.filter(r => r.m < 60);
  const pPlayBench = nonStart.length ? nonStart.filter(r => r.m > 0).length / nonStart.length : A.playNotStart;
  if (camRows.length >= 2 && n === 0) ev.push('cameo pattern (' + camRows.map(r => Math.round(r.m) + "'").join(', ') + ') — bench role');

  // ---- the ladder ----
  const pStart = Math.max(0.01, Math.min(0.97, avail * pStartRaw));
  const p60 = pStart * d60, p75 = pStart * d75, p90 = pStart * d90;
  const expectedMinutes = Math.max(0, Math.min(95, avail * (pStartRaw * minsPerStart + (1 - pStartRaw) * pPlayBench * cameoAvg)));

  // ---- confidence (three honest components) ----
  const data = Math.min(1, rows.length / 4);
  let stability;
  if (rows.length >= 2) {
    const ms = rows.map(r => r.m), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const sd = Math.sqrt(ms.reduce((s, m) => s + (m - mean) * (m - mean), 0) / ms.length);
    stability = Math.max(0, Math.min(1, 1 - sd / 45));
    if (sd > 30 && rows.length >= 3) ev.push('variable minutes (' + ms.map(m => Math.round(m)).join('-') + ") — rotation/sub pattern");
  } else stability = 0.4;
  const availabilityC = (st === 'a' && ch == null) ? 1 : Math.max(0.05, 0.15 + 0.85 * avail);
  const overall = Math.round(100 * (0.4 * data + 0.35 * stability + 0.25 * availabilityC)) / 100;

  const out = {
    pStart: Math.round(pStart * 100) / 100, p60: Math.round(p60 * 100) / 100,
    p75: Math.round(p75 * 100) / 100, p90: Math.round(p90 * 100) / 100,
    expectedMinutes: Math.round(expectedMinutes * 10) / 10,
    confidence: { overall, data: Math.round(data * 100) / 100, minutes: Math.round(stability * 100) / 100, availability: Math.round(availabilityC * 100) / 100 },
    evidence: ev, n: rows.length, starts: n, minsPerStart: Math.round(minsPerStart), cameoAvg: Math.round(cameoAvg),
  };
  V2M_MEMO[key] = out;
  return out;
}

// ============ 🏟️ TEAM STRENGTH V2 (v2.0 Phase 3) — attack/defence ratings ============
// teamRatingsV2() — NOT wired into production forecasts yet. Built beside the
// legacy osmBuild() (v25 opponent-strength) for A/B comparison (v2.0 audit,
// Phase 3). Upgrades over legacy:
//   1. blends real goals WITH xG (xG is stabler, goals capture finishing),
//   2. opponent-adjusts ratings (a goal vs a strong defence counts more) —
//      two multiplicative iterations, normalized to league mean 1.0,
//   3. home/away splits, shrunk toward the team's overall rating,
//   4. the audit's shrinkage schedule: w = n/(n+7) -> 30% current at n=3,
//      50% at n=7, 70% by n=16 (data-driven, not a hard 60/40 forever),
//   5. expectedGoals(home, away) — the feed the Phase-5 event model needs.
// Everything is deterministic from DATA.results (real GW1-N matches).
const TSR_MEMO = {};
function teamRatingsV2() {
  if (TSR_MEMO.out) return TSR_MEMO.out;
  const ms = (DATA.results || []).filter(m => m && m.home && m.away);
  if (ms.length < 10) { TSR_MEMO.out = { teams: {}, league: { n: 0 }, expectedGoals: () => ({ hg: 1.3, ag: 1.1 }) }; return TSR_MEMO.out; }

  // ---- league base rates (real) ----
  const totH = ms.reduce((s, m) => s + (m.hs || 0), 0), totA = ms.reduce((s, m) => s + (m.as_ || 0), 0);
  const baseH = totH / ms.length, baseA = totA / ms.length;          // goals per match, home & away
  const meanAtt = (totH + totA) / (2 * ms.length);                    // league mean output per team-game
  const W_XG = 0.6;                                                   // xG weight in the blend (goals 0.4)

  // ---- raw per-team signals (goals+xG blend), overall + home/away ----
  const R = {};
  ms.forEach(m => {
    const sides = [
      [m.home, 'H', m.hxg, m.axg, m.hs || 0, m.as_ || 0],
      [m.away, 'A', m.axg, m.hxg, m.as_ || 0, m.hs || 0]];
    sides.forEach(([t, ha, xgf, xga, gf, ga]) => {
      const o = R[t] = R[t] || { n: 0, att: 0, def: 0, oppAtt: 0, oppDef: 0, nH: 0, attH: 0, defH: 0, nA: 0, attA: 0, defA: 0, opp: [] };
      const attSig = W_XG * (xgf || 0) + (1 - W_XG) * gf;             // blended output
      const defSig = W_XG * (xga || 0) + (1 - W_XG) * ga;             // blended concession
      o.n++; o.att += attSig; o.def += defSig; o.opp.push(m[ha === 'H' ? 'away' : 'home']);
      if (ha === 'H') { o.nH++; o.attH += attSig; o.defH += defSig; } else { o.nA++; o.attA += attSig; o.defA += defSig; }
    });
  });
  const names = Object.keys(R);
  if (!names.length) { TSR_MEMO.out = { teams: {}, league: { n: 0 }, expectedGoals: () => ({ hg: 1.3, ag: 1.1 }) }; return TSR_MEMO.out; }

  // ---- shrinkage toward the league mean (audit schedule: w = n/(n+7)) ----
  const shr = (sum, n) => { const w = n / (n + 7); return w * (sum / n) + (1 - w) * meanAtt; };
  names.forEach(t => {
    const o = R[t];
    o.attRaw = o.att / o.n; o.defRaw = o.def / o.n;
    o.attShr = shr(o.att, o.n); o.defShr = shr(o.def, o.n);          // multiplicative form later
    o.attShrM = o.attShr / meanAtt; o.defShrM = o.defShr / meanAtt;  // 1.0 = league average
    // home/away: shrink toward the team's OWN overall rating (K=3 — tiny samples)
    const wH = o.nH / (o.nH + 3), wA = o.nA / (o.nA + 3);
    o.attHomeM = o.nH ? (wH * (o.attH / o.nH) + (1 - wH) * o.attShr) / o.attShr : 1;
    o.attAwayM = o.nA ? (wA * (o.attA / o.nA) + (1 - wA) * o.attShr) / o.attShr : 1;
    o.defHomeM = o.nH ? (wH * (o.defH / o.nH) + (1 - wH) * o.defShr) / o.defShr : 1;
    o.defAwayM = o.nA ? (wA * (o.defA / o.nA) + (1 - wA) * o.defShr) / o.defShr : 1;
  });

  // ---- opponent adjustment: 2 multiplicative iterations, mean-normalized ----
  let attM = {}, defM = {};
  names.forEach(t => { attM[t] = R[t].attShrM; defM[t] = R[t].defShrM; });
  for (let it = 0; it < 2; it++) {
    const nA2 = {}, nD2 = {};
    names.forEach(t => {
      const ops = R[t].opp, k = ops.length || 1;
      const defFaced = ops.reduce((s, o) => s + (defM[o] || 1), 0) / k;
      const attFaced = ops.reduce((s, o) => s + (attM[o] || 1), 0) / k;
      nA2[t] = (R[t].attShrM / (defFaced || 1));                     // scoring vs tough defences counts more
      nD2[t] = (R[t].defShrM / (attFaced || 1));                      // conceding vs strong attacks hurts less
    });
    const mA = names.reduce((s, t) => s + nA2[t], 0) / names.length;
    const mD = names.reduce((s, t) => s + nD2[t], 0) / names.length;
    names.forEach(t => { attM[t] = nA2[t] / mA; defM[t] = nD2[t] / mD; });
  }

  // ---- expose ----
  const teams = {};
  names.forEach(t => {
    const o = R[t];
    teams[t] = {
      short: t, n: o.n,
      attRaw: Math.round(o.attRaw * 1000) / 1000, defRaw: Math.round(o.defRaw * 1000) / 1000,
      attShr: Math.round(o.attShrM * 1000) / 1000, defShr: Math.round(o.defShrM * 1000) / 1000,
      att: Math.round(attM[t] * 1000) / 1000, def: Math.round(defM[t] * 1000) / 1000,
      attHome: Math.round(attM[t] * o.attHomeM * 1000) / 1000, attAway: Math.round(attM[t] * o.attAwayM * 1000) / 1000,
      defHome: Math.round(defM[t] * o.defHomeM * 1000) / 1000, defAway: Math.round(defM[t] * o.defAwayM * 1000) / 1000,
    };
  });

  const rawXG = (home, away) => {
    const H = teams[home], Aa = teams[away];
    return { hg: H && Aa ? baseH * H.attHome * Aa.defAway : baseH,
             ag: H && Aa ? baseA * Aa.attAway * H.defHome : baseA };
  };
  // multiplicative models drift high on small samples — calibrate the bases so the
  // model's predicted totals over the REAL matches equal the actual totals.
  let pH = 0, pA = 0;
  ms.forEach(m => { const g = rawXG(m.home, m.away); pH += g.hg; pA += g.ag; });
  const cH = pH > 0 ? Math.max(0.7, Math.min(1.4, totH / pH)) : 1;
  const cA = pA > 0 ? Math.max(0.7, Math.min(1.4, totA / pA)) : 1;
  const calH = baseH * cH, calA = baseA * cA;
  const expectedGoals = (home, away) => {
    const g = rawXG(home, away);
    const hg = teams[home] ? g.hg * cH : calH, ag = teams[away] ? g.ag * cA : calA;
    return { hg: Math.round(Math.max(0.15, Math.min(4.5, hg)) * 100) / 100, ag: Math.round(Math.max(0.1, Math.min(4.2, ag)) * 100) / 100 };
  };

  TSR_MEMO.out = {
    version: 2, teams,
    league: { n: ms.length, baseH: Math.round(calH * 100) / 100, baseA: Math.round(calA * 100) / 100, meanAtt: Math.round(meanAtt * 1000) / 1000, calib: { cH: Math.round(cH * 1000) / 1000, cA: Math.round(cA * 1000) / 1000 },
      shrinkage: 'w = n/(n+7) — 30% current at 3 games, 50% at 7, 70% at 16', blend: W_XG + ' xG / ' + (1 - W_XG) + ' goals' },
    expectedGoals,
  };
  return TSR_MEMO.out;
}

// ============ 🧭 FIXTURE DIFFICULTY V2 (v2.0 Phase 4) — position-aware grades ============
// fixtureDifficultyV2(team, opp, ha) — NOT wired into production yet. Built beside the
// legacy fixtureFactor()/oppFixOf() (v36 smooth grading) for A/B comparison (v2.0
// audit, Phase 4 / Model 3 extension: "attacker, midfielder, defender, goalkeeper —
// a single FDR number is not sufficient").
//
// Drivers, all from teamRatingsV2 (Phase 3, opponent-adjusted + calibrated):
//   ATTACKERS (FWD):  his team's expected goals in this fixture  -> open-play opportunity
//   MIDFIELDERS:      65% attacking + 35% clean-sheet lens (mids earn both)
//   DEFENDERS:        clean-sheet probability  P(opp scores 0) = exp(-oppXG)
//   GOALKEEPERS:      clean-sheet probability, softened by save points when busy
// Difficulty is a CONTINUOUS 1-5 scale (1 easy, 5 brutal) — piecewise-linear maps,
// no hard bucket edges (the v36 lesson). Every grade carries its raw drivers.
const FXV2_MEMO = {};
function fxv2MapAtt(x) {  // expected goals FOR -> attacker difficulty
  const P = [[.5, 4.8], [.8, 4.0], [1.1, 3.2], [1.4, 2.5], [1.8, 1.9], [2.2, 1.5], [2.8, 1.2], [3.5, 1.0]];
  if (x <= P[0][0]) return 5; if (x >= P[P.length - 1][0]) return 1;
  for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const t = (x - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + t * (P[i][1] - P[i - 1][1]); }
  return 1;
}
function fxv2MapCS(c) {   // clean-sheet probability -> defender difficulty
  const P = [[.10, 4.8], [.18, 4.0], [.26, 3.3], [.34, 2.7], [.42, 2.2], [.50, 1.8], [.60, 1.5], [.72, 1.2]];
  if (c <= P[0][0]) return 4.8; if (c >= P[P.length - 1][0]) return 1;
  for (let i = 1; i < P.length; i++) if (c <= P[i][0]) { const t = (c - P[i - 1][0]) / (P[i][0] - P[i - 1][0]); return P[i - 1][1] + t * (P[i][1] - P[i - 1][1]); }
  return 1;
}
function fxv2Label(s) { return s <= 1.8 ? 'great' : s <= 2.6 ? 'good' : s <= 3.4 ? 'neutral' : s <= 4.2 ? 'tricky' : 'tough'; }
function fixtureDifficultyV2(team, opp, ha) {
  const key = team + '|' + opp + '|' + ha;
  if (FXV2_MEMO[key]) return FXV2_MEMO[key];
  const R = (typeof teamRatingsV2 === 'function') ? teamRatingsV2() : null;
  if (!R || !R.teams[team] || !R.teams[opp]) {
    const neutral = { FWD: 3, MID: 3, DEF: 3, GK: 3 };
    Object.keys(neutral).forEach(k => neutral[k] = { score: 3, label: 'neutral', why: 'no rating data for this fixture yet' });
    const out = { team, opp, ha, xgFor: null, oppXG: null, csProb: null, savesExp: null, pos: neutral, note: 'neutral fallback — team not in the ratings set' };
    FXV2_MEMO[key] = out; return out;
  }
  const g = ha === 'H' ? R.expectedGoals(team, opp) : R.expectedGoals(opp, team);
  const xgFor = ha === 'H' ? g.hg : g.ag;      // our expected goals
  const oppXG = ha === 'H' ? g.ag : g.hg;      // their expected goals (our concession risk)
  const csProb = Math.exp(-oppXG);             // Poisson P(they score 0)
  const savesExp = Math.round(1.86 * oppXG * 10) / 10;  // ~SoT-faced − goals (conv ~35%)
  const r2 = (v) => Math.round(v * 100) / 100;
  const fwd = fxv2MapAtt(xgFor);
  const def = fxv2MapCS(csProb);
  const mid = 0.65 * fwd + 0.35 * def;
  const gk = Math.max(1, def - (savesExp >= 3.5 ? 0.2 : 0));   // busy keepers bank save points
  const pos = {
    FWD: { score: r2(fwd), label: fxv2Label(fwd), why: 'his team projects ' + xgFor.toFixed(2) + ' goals — open-play opportunity' },
    MID: { score: r2(mid), label: fxv2Label(mid), why: '65% attack lens (' + xgFor.toFixed(2) + ' xG for) + 35% CS lens (' + Math.round(csProb * 100) + '% clean sheet)' },
    DEF: { score: r2(def), label: fxv2Label(def), why: Math.round(csProb * 100) + '% clean-sheet chance (opponent projects ' + oppXG.toFixed(2) + ' xG)' },
    GK:  { score: r2(gk), label: fxv2Label(gk), why: Math.round(csProb * 100) + '% clean sheet' + (savesExp >= 3.5 ? ' + ~' + savesExp.toFixed(1) + ' expected saves cushion' : '') },
  };
  const out = { team, opp, ha, xgFor: r2(xgFor), oppXG: r2(oppXG), csProb: r2(csProb), savesExp, pos, version: 2 };
  FXV2_MEMO[key] = out; return out;
}
// a player's next-3 fixture through HIS position's lens (bridge for later phases)
function posFixGrade(p, i) {
  const f = (p && p.next3 && p.next3[i]) || null;
  if (!f || !f.opp) return { score: 3, label: 'neutral', why: 'no fixture data' };
  const d = fixtureDifficultyV2(p.team, f.opp, f.ha || 'H');
  const mine = d.pos[p.pos] || d.pos.MID;
  return { opp: f.opp, ha: f.ha, score: mine.score, label: mine.label, why: mine.why, all: d.pos, xgFor: d.xgFor, csProb: d.csProb };
}
// ============ ONE FORECAST OBJECT (audit P0 · v30) ============
// Every decision surface reads forecastOf(p) — one canonical per-GW object that
// carries xP, return chances, the outcome spread, minutes and confidence from
// the SAME spine, so those numbers can never silently come from two different
// models again. Official FPL ep_next is kept only as a labelled reference field.
// Everything is a deterministic model estimate from real GW1-N data.
const MIN_MEMO = {}, FC_MEMO = {};
function minutesOf(p) {
  const key = 'm|' + p.id + '|' + (p.mins || 0) + '|' + (p.status || 'a');
  if (MIN_MEMO[key]) return MIN_MEMO[key];
  const rows = (DATA.history || {})[p.id] || [];
  const ps = startProb(p);
  let starts = 0, stMins = 0, allMins = 0, apps = 0;
  rows.forEach(r => { const m = r[4] || 0; allMins += m; if (m > 0) apps++; if (m >= 60) { starts++; stMins += m; } });
  // position prior for "real minutes per start" (whole-pool, memoised)
  if (!MIN_MEMO._pri) {
    const st = {};
    (DATA.players || []).forEach(pl => {
      for (const r of (DATA.history || {})[pl.id] || []) { const m = r[4] || 0; if (m >= 60) { const o = st[pl.pos] = st[pl.pos] || { n: 0, s: 0 }; o.n++; o.s += m; } }
    });
    const avg = {}; Object.keys(st).forEach(k => { avg[k] = st[k].n ? st[k].s / st[k].n : 80; });
    MIN_MEMO._pri = avg;
  }
  const playMin = starts ? stMins / starts : (MIN_MEMO._pri[p.pos] || 80);     // real mins per start (prior when new)
  const cameoAvg = apps > starts ? (allMins - stMins) / (apps - starts) : 22;  // real mins per cameo (prior 22)
  const expMin = Math.max(0, Math.min(96, Math.round((ps * playMin + (1 - ps) * cameoAvg) * 10) / 10));
  const p60 = apps ? Math.round(Math.min(ps, ps * (starts / apps)) * 100) / 100 : 0; // P(≥60) ≤ P(start) & real start share
  const o = { pStart: Math.round(ps * 100) / 100, p60, expMin, n: rows.length, avgAll: rows.length ? Math.round(100 * allMins / rows.length) / 100 : 0 };
  MIN_MEMO[key] = o;
  return o;
}
function confOf(p) {
  const P = playerProb(p);
  const M = minutesOf(p);
  const doubt = (p.status === 'i' || p.status === 's');
  const n = P.n || 0;
  let lvl, why;
  if (doubt) { lvl = 'LOW'; why = (p.status === 'i' ? 'injured' : 'suspended') + ' — not reliable this GW'; }
  else if (n === 0) { lvl = 'LOW'; why = 'no GW1-N data yet (new/returning signing)'; }
  else if (n === 1) { lvl = 'LOW'; why = 'only 1 GW of own data'; }
  else if (n === 2) { lvl = 'MED'; why = '2 GWs of own data'; }
  else { lvl = (M.pStart >= 0.75) ? 'HIGH' : 'MED'; why = (M.pStart >= 0.75) ? '3+ GWs + secure starts' : '3+ GWs but rotation risk'; }
  return { lvl, why, n };
}
// canonical next-GW forecast for a catalog player — one object, one spine
function forecastOf(p) {
  if (!p) return null;
  if (FC_MEMO[p.id]) return FC_MEMO[p.id];
  const P = playerProb(p), M = minutesOf(p), C = confOf(p), D = distOf(p);
  const o = {
    id: p.id, name: p.name, pos: p.pos, team: p.team,
    gw: ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1,   // the GW this forecast is FOR
    xp: Math.round(projP(p, 0) * 10) / 10,                       // model expected points (single voice)
    ep: p.ep_next ?? 0,                                          // official FPL reference (labelled, not the model)
    p6: P.p6, p10: P.p10, sd: P.sd, n: P.n,
    dist: D.prob, distMean: D.mean,
    minutes: M,
    conf: C,
  };
  FC_MEMO[p.id] = o;
  return o;
}
// model expected points for an element id (null when the player isn't in the catalog)
function modelXpById(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? forecastOf(p).xp : null;
}
function fcOfId(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? forecastOf(p) : null;
}
// one-line HTML: confidence + expected minutes, for any surface that shows an xP
function fcMetaLine(f) {
  if (!f) return '';
  const m = f.minutes, c = f.conf;
  const cc = c.lvl === 'HIGH' ? 'var(--green)' : c.lvl === 'MED' ? 'var(--amber)' : 'var(--red)';
  return '<span class="mrow">🎯 model xP <b>' + f.xp.toFixed(1) + '</b> · minutes ~' + Math.round(m.pStart * 100) + '% start / ~' + m.expMin + "′ exp · confidence <b style=\"color:" + cc + '">' + c.lvl + '</b> <span class="muted">(' + esc(c.why) + ')</span></span>';
}
// ---- Probability profile (audit P0 #3: expected points ≠ probability) ----
// xPts (projP) is the point ESTIMATE. These chips answer a different question:
// "how likely is a return/haul this GW?" They are calibrated from REAL results —
// every starter's GW1-N points across the player pool give a league base rate by
// position, blended with the player's OWN real GW1-N record (shrunk, so a 2-3 GW
// sample never dominates). Every output is a labelled model estimate.
const PP_MEMO = {};
const PP_K = 3; // shrinkage weight — own record trusted more as GWs accumulate
function ppScores(p) { return ((DATA.history || {})[p.id] || []).map(r => r[1] || 0); }
function ppBaseRates() {
  if (PP_MEMO.base) return PP_MEMO.base;
  const st = {}; // starters only (>=60 mins) — best proxy for "actually plays"
  for (const p of DATA.players) for (const r of (DATA.history || {})[p.id] || []) {
    if ((r[4] || 0) < 60) continue;
    const o = st[p.pos] = st[p.pos] || { n: 0, r6: 0, r10: 0, sum: 0, sq: 0 };
    const pts = r[1] || 0; o.n++; o.sum += pts; o.sq += pts * pts;
    if (pts >= 6) o.r6++; if (pts >= 10) o.r10++;
  }
  PP_MEMO.base = st;
  return st;
}
function playerProb(p, over) {
  const mins = over && over.mins != null ? over.mins : (p.mins || 0);
  const status = over && over.status != null ? over.status : (p.status || 'a');
  // v31 fixture-aware probabilities (B2): return chances respond to the opponent,
  // exactly like the xP already does — restores consistency inside forecastOf.
  const oppFx = (typeof fixtureFactor === 'function')
    ? fixtureFactor(p, over && over.i != null ? over.i : 0)
    : ((typeof oppFixOf === 'function') ? oppFixOf(p, over && over.i != null ? over.i : 0) : null);
  const key = p.id + '|' + mins + '|' + status + (oppFx ? '|' + oppFx.band + ':' + oppFx.opp + ':' + (oppFx.afdr == null ? '-' : oppFx.afdr) : '');
  if (PP_MEMO[key]) return PP_MEMO[key];
  const scores = ppScores(p);
  const n = scores.length;
  const obs6 = scores.filter(x => x >= 6).length, obs10 = scores.filter(x => x >= 10).length;
  const b = ppBaseRates()[p.pos] || { n: 1, r6: 0, r10: 0, sum: 0, sq: 0 };
  const prior6 = b.n ? 100 * b.r6 / b.n : 10;
  const prior10 = b.n ? 100 * b.r10 / b.n : 3;
  const w = n / (n + PP_K);
  let p6 = n ? w * (100 * obs6 / n) + (1 - w) * prior6 : prior6;
  let p10 = n ? w * (100 * obs10 / n) + (1 - w) * prior10 : prior10;
  // minutes gate: a benched player cannot return; scale both chances down
  const minProb = startProb(p, { mins, status });
  const gate = 0.25 + 0.75 * minProb;
  p6 = Math.max(1, Math.min(85, Math.round(p6 * gate)));
  p10 = Math.max(1, Math.min(60, Math.round(p10 * gate)));
  if (oppFx && oppFx.pf !== 1) {
    p6 = Math.max(1, Math.min(85, Math.round(p6 * oppFx.pf)));
    p10 = Math.max(1, Math.min(60, Math.round(p10 * oppFx.pf)));
    if (p10 > p6) p10 = p6;
  }
  const avg = n ? scores.reduce((a, x) => a + x, 0) / n : 0;
  let sd = n > 1 ? Math.sqrt(scores.reduce((s, x) => s + (x - avg) * (x - avg), 0) / (n - 1)) : 0;
  if (n < 2) sd = b.n ? Math.sqrt(Math.max(0, b.sq / b.n - (b.sum / b.n) * (b.sum / b.n))) : 3;
  sd = Math.max(1.5, Math.min(8, Math.round(sd * 10) / 10)); // typical per-GW swing
  const best = n ? Math.max.apply(null, scores) : 0;
  PP_MEMO[key] = { n, p6, p10, sd, best, obs6, obs10, prior6: Math.round(prior6), prior10: Math.round(prior10), fx: oppFx ? oppFx.band : null };
  return PP_MEMO[key];
}
// two labelled chance rows used inside H2H / Compare cards
function ppRows(p) {
  const P = playerProb(p);
  const c6 = P.p6 >= 40 ? 'var(--green)' : P.p6 >= 20 ? 'var(--amber)' : 'var(--red)';
  const c10 = P.p10 >= 12 ? 'var(--green)' : P.p10 >= 5 ? 'var(--amber)' : 'var(--red)';
  return '<div style="display:flex;justify-content:space-between"><span class="muted" title="chance of a 6+ point return this GW — own real GW1-3 record blended with the league base rate for his position">P(≥6) <i>chance</i></span><b style="color:' + c6 + '">' + P.p6 + '%</b></div>'
    + '<div style="display:flex;justify-content:space-between"><span class="muted" title="chance of a 10+ point haul this GW">P(≥10) <i>chance</i></span><b style="color:' + c10 + '">' + P.p10 + '%</b></div>'
    + '<div style="display:flex;justify-content:space-between"><span class="muted" title="typical per-GW swing from his real GW1-3 points">swing ±/GW</span><b>' + P.sd.toFixed(1) + '</b></div>';
}
// ---- Probabilistic per-GW projection (audit roadmap #7) ----
// A full next-GW OUTCOME SPREAD for a player over 5 bands:
//   ≤0 · 1–2 · 3–5 · 6–9 · 10+   (probabilities sum to 1)
// Construction keeps it exactly consistent with the P(≥6)/P(≥10) rows already
// shown: the ≥10 and 6–9 bands are pinned to those probabilities, and the
// remaining mass is split across the low bands using the player's REAL GW1-N
// scores blended with the position base (shrinkage) and gated by P(starts).
// Every number is a labelled model estimate from real results.
function distShape(p) {
  const band = (pts, mins) => { if ((mins || 0) < 60) return -1; return pts <= 0 ? 0 : pts <= 2 ? 1 : pts <= 5 ? 2 : pts <= 9 ? 3 : 4; };
  if (!PP_MEMO._posShape) {
    const st = { GK: [0, 0, 0, 0, 0], DEF: [0, 0, 0, 0, 0], MID: [0, 0, 0, 0, 0], FWD: [0, 0, 0, 0, 0] };
    (DATA.players || []).forEach(pl => {
      for (const r of (DATA.history || {})[pl.id] || []) { const b = band(r[1], r[4]); if (b >= 0 && st[pl.pos]) st[pl.pos][b]++; }
    });
    PP_MEMO._posShape = st;
  }
  const own = [0, 0, 0, 0, 0]; let n = 0;
  for (const r of (DATA.history || {})[p.id] || []) { const b = band(r[1], r[4]); if (b >= 0) { own[b]++; n++; } }
  const pos = PP_MEMO._posShape[p.pos] || [0, 0, 0, 0, 0];
  const posN = pos.reduce((a, b) => a + b, 0) || 1;
  const w = n / (n + 1.5);
  const blend = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) blend[i] = w * own[i] / (n || 1) + (1 - w) * pos[i] / posN;
  return { shape: blend, posN, ownN: n };
}
function distOf(p, over) {
  const P = playerProb(p, over);                       // p6 / p10 / sd — single source of truth
  let p6 = P.p6 / 100, p10 = P.p10 / 100;
  if (p10 > p6) p10 = p6;                              // defensive (shouldn't happen)
  const { shape } = distShape(p);
  const lowW = shape[0] + shape[1] + shape[2] || 1;    // real low-band split
  const prob = [
    shape[0] / lowW * (1 - p6),
    shape[1] / lowW * (1 - p6),
    shape[2] / lowW * (1 - p6),
    p6 - p10,                                          // 6–9  == P(≥6) − P(≥10)
    p10,                                               // 10+  == P(≥10)
  ];
  const mids = [0, 1.5, 4, 7.5, 12];
  const mean = Math.round(prob.reduce((a, x, i) => a + x * mids[i], 0) * 100) / 100;
  return { prob, mean, p6: P.p6, p10: P.p10 };
}
// one compact stacked "outcome spread" bar (5 coloured segments + tooltip %)
function distBar(p, over) {
  const D = distOf(p, over);
  const cols = ['#5a6a85', '#7a8bb0', '#e6a23c', '#4cd964', '#2dd4a7'];
  const lab = ['≤0', '1–2', '3–5', '6–9', '10+'];
  const segs = D.prob.map((x, i) => `<div style="flex:${Math.max(1, Math.round(x * 1000))};background:${cols[i]};min-width:${x > 0.03 ? 12 : 2}px;height:10px;border-radius:2px" title="${lab[i]}: ${Math.round(x * 100)}%"></div>`).join('');
  return `<div style="margin-top:5px"><div class="muted" style="font-size:11px">outcome spread (chance view — sums to 100%) · xP shown separately on the card</div><div style="display:flex;gap:2px;width:100%">${segs}</div></div>`;
}

function startersAt(squad, i) {
  return bestXI(squad, p => projP(p, i)) || squad.slice(0, 11);
}
const teamProjAt = (squad, i) => {
  const st = startersAt(squad, i);
  return st.reduce((s, p) => s + projP(p, i), 0) + Math.max(0, ...st.map(p => projP(p, i)));
};
// ---- Captain leverage (audit roadmap #10) ----
// Armband edge vs the FIELD captain (whom most rivals / the public will pick):
//   expected edge = E(C) - E(F)   haul edge = P(>=10|C) - P(>=10|F)
// +ve edge means captaining C is EXPECTED to beat the field this GW. Every
// figure is a single-GW model estimate — labelled, never a promise.
function capLev(C, F) {
  const eEp = Math.round(((C.ep || 0) - (F.ep || 0)) * 10) / 10;
  const eP6 = Math.round(((C.p6 || 0) - (F.p6 || 0)) * 10) / 10;
  const eP10 = Math.round(((C.p10 || 0) - (F.p10 || 0)) * 10) / 10;
  let cls = 'MATCH', txt = 'about what the field gets — zero leverage';
  if (eEp >= 0.4) { cls = 'UPSIDE'; txt = 'beats the field captain on expected pts'; }
  else if (eEp <= -0.4) { cls = 'BEHIND'; txt = 'trails the field on expected pts — a contrarian gamble'; }
  if (cls === 'UPSIDE' && eP10 < -4) { cls = 'SWING'; txt = 'expected edge over the field, but a LOWER haul chance — upside with ceiling risk'; }
  else if (cls !== 'UPSIDE' && eEp >= 0 && eP10 >= 4) { cls = 'HAUL'; txt = 'matched on expected pts but a higher ceiling than the field'; }
  return { eEp, eP6, eP10, cls, txt };
}
function capLevColor(cls) {
  return (cls === 'UPSIDE' || cls === 'HAUL') ? 'var(--green)' : cls === 'MATCH' ? 'var(--amber)' : cls === 'SWING' ? 'var(--amber)' : 'var(--red)';
}
// field captain = the candidate the most rivals currently captain (tie -> higher ep)
function capFieldOf(cands) {
  const c = cands.slice().sort((a, b) => ((b.fieldShare || 0) - (a.fieldShare || 0)) || ((b.ep || 0) - (a.ep || 0)))[0];
  return c || null;
}
// one-line HTML leverage readout for a candidate vs the field captain
function capLevLine(C, F) {
  if (!C || !F) return '';
  if (C === F || (C.name && C.name === F.name)) return '<span class="muted">field captain — captaining him is zero leverage (safe)</span>';
  const L = capLev(C, F);
  const col = capLevColor(L.cls);
  const epTxt = (L.eEp > 0 ? '+' : '') + L.eEp.toFixed(1);
  const haulTxt = (F.p10 != null && C.p10 != null) ? ' · haul ' + (L.eP10 > 0 ? '+' : '') + L.eP10.toFixed(0) + '%' : '';
  return '<span class="tk-opp">leverage vs field (' + esc(F.name) + '): <b style="color:' + col + '">' + epTxt + ' ep</b>' + haulTxt + ' · <i>' + L.txt + '</i></span>';
}
// haul/return profile for an element id if it exists in the player catalog (else null)
function ppOfId(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? playerProb(p) : null;
}

// Legal FPL formations (outfield D+M+F = 10; each XI = GK1 + D3-5 + M3-5 + F1-3)
const LEGAL_FMS = (() => { const a = []; for (let d = 3; d <= 5; d++) for (let m = 3; m <= 5; m++) { const f = 10 - d - m; if (f >= 1 && f <= 3) a.push([1, d, m, f]); } return a; })();
const posKey = p => { const x = p.pos; return (x === 1 || x === 'GK') ? 'GK' : (x === 2 || x === 'DEF') ? 'DEF' : (x === 3 || x === 'MID') ? 'MID' : 'FWD'; };
// best legal 11 from a squad (players may carry pos as numeric 1-4 or string)
function bestXI(list, scoreFn) {
  const g = { GK: [], DEF: [], MID: [], FWD: [] };
  list.forEach(p => { (g[posKey(p)] || g.FWD).push(p); });
  ['GK', 'DEF', 'MID', 'FWD'].forEach(k => g[k].sort((a, b) => scoreFn(b) - scoreFn(a)));
  let best = null;
  for (const [gk, d, m, f] of LEGAL_FMS) {
    if (g.GK.length < gk || g.DEF.length < d || g.MID.length < m || g.FWD.length < f) continue;
    const cand = [...g.GK.slice(0, gk), ...g.DEF.slice(0, d), ...g.MID.slice(0, m), ...g.FWD.slice(0, f)];
    if (cand.length !== 11) continue;
    const sum = cand.reduce((x, p) => x + scoreFn(p), 0);
    if (!best || sum > best.sum) best = { sum, xi: cand };
  }
  return best ? best.xi : null;
}

const shapeOK = (squad, out, inn) => {
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  squad.forEach(p => c[p.pos]++);
  c[out.pos]--; c[inn.pos]++;
  return c.GK >= 1 && c.GK <= 2 && c.DEF >= 3 && c.DEF <= 5 && c.MID >= 3 && c.MID <= 5 && c.FWD >= 2 && c.FWD <= 3;
};

// P2 polish: per-player "schedule strip" — REAL past form (bars) + next-5
// projection (dashed line) with the opponent & difficulty colouring each GW.
function pfxCol(fdr) {
  const i = Math.max(0, Math.min(4, (Math.round(+fdr) || 3) - 1));
  return ['#2dd4a7', '#82c91e', '#e6a23c', '#ffa94d', '#ff6b6b'][i];
}
function playerScheduleSVG(p, opts) {
  const o = opts || {};
  const W = o.w || 560, Hpx = o.h || 178, PL = 26, PR = 6, PT = 12, PB = 44;
  const rows = (DATA.history || {})[p.id] || [];
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const real = rows.filter(r => (r[0] || 0) <= cur)
    .map(r => ({ g: r[0], pts: r[1] || 0, st: (r[4] || 0) >= 60 }))
    .sort((a, b) => a.g - b.g);
  const projFn = (typeof projP === 'function') ? projP : () => (+(p.ep_next || 0));
  const fut = [];
  for (let i = 0; i < 5; i++) {
    const f = (p.next3 || [])[i] || null;
    fut.push({ g: cur + 1 + i, proj: projFn(p, i), f });
  }
  const xs = [];
  real.forEach(r => xs.push({ t: 'r', g: r.g, pts: r.pts, st: r.st, proj: r.pts }));
  fut.forEach(x => xs.push({ t: 'f', g: x.g, proj: x.proj, f: x.f, opp: (x.f && x.f.opp) || '—', ha: (x.f && x.f.ha) || '?' }));
  if (!xs.length) return '';
  const X = i => PL + (W - PL - PR) * (xs.length === 1 ? 0.5 : i / (xs.length - 1));
  const yMax = Math.max(4, Math.ceil(Math.max.apply(null, xs.map(x => x.proj)) * 1.15));
  const Y = v => PT + (Hpx - PT - PB) * (1 - v / yMax);
  let g = '';
  // gridlines + y labels
  for (let t = 0; t <= 4; t++) {
    const v = yMax * t / 4, y = Y(v);
    g += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,${t === 0 ? 0.25 : 0.06})"/>`;
    g += `<text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a93a6">${Math.round(v)}</text>`;
  }
  const realXs = [], futXs = [];
  xs.forEach((x, i) => {
    if (x.t === 'r') realXs.push({ i, x });
    else futXs.push({ i, x });
  });
  // real form bars
  realXs.forEach(({ i, x }) => {
    const h = Math.max(1.5, (x.pts / yMax) * (Hpx - PT - PB));
    const fill = !x.st ? '#4a5568' : x.pts >= 6 ? '#00ff85' : '#4dc3ff';
    const op = !x.st ? 0.6 : 0.9;
    g += `<rect x="${(X(i) - 7).toFixed(1)}" y="${(Y(x.pts) - 2).toFixed(1)}" width="14" height="${h.toFixed(1)}" rx="2" fill="${fill}" opacity="${op}"><title>GW${x.g}: ${x.pts} pts${x.st ? '' : ' (sub/bench)'}</title></rect>`;
  });
  // future projection line + dots + fixture labels
  if (futXs.length) {
    const pts = futXs.map(({ i, x }) => `${X(i).toFixed(1)},${Y(x.proj).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="5 3"/>`;
    futXs.forEach(({ i, x }) => {
      const c = x.f && x.f.afdr != null ? pfxCol(x.f.afdr) : (x.f && x.f.fdr != null ? pfxCol(x.f.fdr) : '#e6a23c');
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.proj).toFixed(1)}" r="4" fill="${c}" stroke="#0b0e17" stroke-width="1"><title>GW${x.g}: proj ${x.proj.toFixed(1)}</title></circle>`;
    });
  }
  // divider between real & future
  if (realXs.length && futXs.length) {
    const dx = (X(realXs[realXs.length - 1].i) + X(futXs[0].i)) / 2;
    g += `<line x1="${dx.toFixed(1)}" y1="${PT}" x2="${dx.toFixed(1)}" y2="${Hpx - PB}" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 3"/>`;
  }
  // x labels: real GW numbers, then GW + opponent(+ha) + coloured difficulty
  xs.forEach((x, i) => {
    if (x.t === 'r') {
      g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 12}" text-anchor="middle" font-size="9.5" fill="#8a93a6">GW${x.g}</text>`;
      return;
    }
    const c = x.f && x.f.afdr != null ? pfxCol(x.f.afdr) : (x.f && x.f.fdr != null ? pfxCol(x.f.fdr) : '#e6a23c');
    const fd = x.f ? (x.f.afdr ?? x.f.fdr) : '—';
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 12}" text-anchor="middle" font-size="8.5" fill="#8a93a6">GW${x.g}</text>`;
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 24}" text-anchor="middle" font-size="9.5" fill="#e8ecf4">${x.opp}${x.ha === 'H' ? '(H)' : x.ha === 'A' ? '(A)' : ''}</text>`;
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 36}" text-anchor="middle" font-size="9" font-weight="700" fill="${c}">${fd}</text>`;
  });
  return `<svg width="${W}" height="${Hpx}" viewBox="0 0 ${W} ${Hpx}" style="max-width:100%;background:rgba(255,255,255,.035);border-radius:8px">
    <text x="${PL}" y="${PT - 2}" font-size="10" fill="#8a93a6">GW1-${cur} real pts <tspan fill="#00ff85">■</tspan> &nbsp;·&nbsp; GW${cur + 1}+ projection <tspan fill="#ffd166">╌</tspan> · dot colour = fixture difficulty (green easy → red hard)</text>
    ${g}</svg>`;
}

function sparkSVG(id, w = 110, h = 30) {
  const s = (DATA.history || {})[id];
  if (!s || !s.length) return '';
  const pts = s.map(r => r[1]), xg = s.map(r => +(r[2] + r[3]).toFixed(2));
  const max = Math.max(4, ...pts, ...xg);
  const X = i => s.length === 1 ? w / 2 : 4 + i * ((w - 8) / (s.length - 1));
  const Y = v => h - 4 - (v / max) * (h - 8);
  const line = a => a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="vertical-align:middle;background:rgba(255,255,255,.04);border-radius:6px">
    <polyline points="${line(xg)}" fill="none" stroke="#4dc3ff" stroke-width="1.5" stroke-dasharray="3 2"/>
    <polyline points="${line(pts)}" fill="none" stroke="#00ff85" stroke-width="2"/>
    <title>per-GW points (green) vs xG+xA (blue dashed)</title></svg>`;
}

// ---- Multi-period planner engine (audit roadmap #8) ----
// The classic greedy solver commits each GW to the single move that looks best
// THIS week (+0.6x next week) — so a transfer that only pays off in GW+2/3, or a
// two-move sequence that needs an "enabler" first, was routinely missed.
// The engine below runs a small BEAM of competing squads across the whole
// horizon and scores every candidate branch with a full forward pass over the
// remaining GWs, then commits only at the end. Result is never worse than the
// old greedy plan (the greedy path is always one of the explored branches).
const PLAN_MARK = 1; // (no-op marker so the block is locatable in tests)
function planPoolCand(squad) {
  return DATA.players.filter(p => p.status === 'a' && p.mins >= 60 && !squad.some(x => x.id === p.id));
}
// one full horizon of decisions: at each GW pick the single best move (or roll)
function planGreedy(squad, bank, ft, H, opts) {
  const o = opts || {};
  const oOut = o.oOut || 6, oIn = o.oIn || 16;
  let sq = squad.slice(), b = bank, f = ft;
  const rows = [];
  for (let i = 0; i < H; i++) {
    const rem = H - i;
    const base = teamProjAt(sq, i);
    let best = null, bestVal = -Infinity;
    const outs = sq.slice().sort((a, c) => hSumP(a, rem) - hSumP(c, rem)).slice(0, oOut);
    const ins = planPoolCand(sq).sort((a, c) => hSumP(c, rem) - hSumP(a, rem)).slice(0, oIn);
    for (const out of outs) for (const inn of ins) {
      if (inn.cost > b + out.cost + 0.1 || !shapeOK(sq, out, inn)) continue;
      const sq2 = sq.map(p => (p === out ? inn : p));
      let val = teamProjAt(sq2, i) - base;
      if (i + 1 < H) val += 0.6 * (teamProjAt(sq2, i + 1) - teamProjAt(sq, i + 1));
      if (f <= 0) val -= 4;
      if (val > bestVal + 0.25) { bestVal = val; best = { out, inn }; }
    }
    const hit = !!best && f <= 0;
    if (best) { b += best.out.cost - best.inn.cost; sq = sq.map(p => (p === best.out ? best.inn : p)); f = Math.max(0, f - 1); }
    else f = Math.min(5, f + 1);
    const st = startersAt(sq, i);
    const cap = st.slice().sort((a, c) => projP(c, i) - projP(a, i))[0];
    rows.push({ gw: i, act: best, hit, cap, proj: teamProjAt(sq, i), ft: f });
  }
  const total = rows.reduce((s, r) => s + r.proj, 0);
  return { squad: sq, bank: b, rows, total };
}
// replay an act-list into the same {rows, total} schema (caps + FT bookkeeping)
function planReplay(squad0, bank0, ft0, acts) {
  let sq = squad0.slice(), b = bank0, f = ft0;
  const rows = acts.map((a, i) => {
    if (a && a.inn) { b += a.out.cost - a.inn.cost; sq = sq.map(p => (p === a.out ? a.inn : p)); f = Math.max(0, f - 1); }
    else f = Math.min(5, f + 1);
    const st = startersAt(sq, i);
    const cap = st.slice().sort((x, c) => projP(c, i) - projP(x, i))[0];
    return { gw: i, act: a && a.inn ? a : null, hit: a && a.inn && a.hit, cap, proj: teamProjAt(sq, i), ft: f };
  });
  const total = rows.reduce((s, r) => s + r.proj, 0);
  return { squad: sq, bank: b, rows, total, acts };
}
// beam search: W competing squads per GW, K candidate moves each, every branch
// carries its banked projected points AND is scored by the FULL remaining-horizon
// forward pass (fast greedy continuation), so a good prefix is never discarded.
function planBeam(squad, bank, ft, H, opts) {
  const o = opts || {};
  const W = o.W || 5, K = o.K || 8;
  const cOut = o.cOut || 5, cIn = o.cIn || 10;
  let beam = [{ sq: squad.slice(), b: bank, f: ft, acts: [], acc: 0 }];
  for (let i = 0; i < H; i++) {
    const rem = H - i;
    const expanded = [];
    for (const nd of beam) {
      const base = teamProjAt(nd.sq, i);
      const outs = nd.sq.slice().sort((a, c) => hSumP(a, rem) - hSumP(c, rem)).slice(0, cOut);
      const ins = planPoolCand(nd.sq).sort((a, c) => hSumP(c, rem) - hSumP(a, rem)).slice(0, cIn);
      const quick = [{ out: null, inn: null, sq2: nd.sq, b2: nd.b, f2: Math.min(5, nd.f + 1), hit: false, val: 0 }];
      for (const out of outs) for (const inn of ins) {
        if (inn.cost > nd.b + out.cost + 0.1 || !shapeOK(nd.sq, out, inn)) continue;
        const sq2 = nd.sq.map(p => (p === out ? inn : p));
        let val = teamProjAt(sq2, i) - base;
        if (i + 1 < H) val += 0.6 * (teamProjAt(sq2, i + 1) - teamProjAt(nd.sq, i + 1));
        if (nd.f <= 0) val -= 4;
        quick.push({ out, inn, sq2, b2: nd.b + out.cost - inn.cost, f2: Math.max(0, nd.f - 1), hit: nd.f <= 0, val });
      }
      quick.sort((a, c) => c.val - a.val).slice(0, K + 1).forEach(c => {
        expanded.push({ sq: c.sq2, b: c.b2, f: c.f2, acc: nd.acc + teamProjAt(c.sq2, i),
          acts: nd.acts.concat([c.inn ? { gw: i, out: c.out, inn: c.inn, hit: c.hit } : null]) });
      });
    }
    // score each branch = points banked so far + full forward pass over the rest
    expanded.forEach(nd => { nd.est = nd.acc + (i + 1 < H ? planGreedy(nd.sq, nd.b, nd.f, H - i - 1, { oOut: 4, oIn: 8 }).total : 0); });
    expanded.sort((a, c) => c.est - a.est);
    beam = expanded.slice(0, W);
  }
  beam.sort((a, c) => c.est - a.est);
  const chosen = beam[0];
  const res = planReplay(squad, bank, ft, chosen.acts);
  res.est = Math.round(chosen.est * 100) / 100;
  // absolute floor: never return a plan worse than the full-width greedy baseline
  const gRes = planGreedy(squad, bank, ft, H, { oOut: 6, oIn: 16 });
  if (gRes.total > res.total) { gRes.est = res.est; return gRes; }
  return res;
}

function solvePlan() {
  const out = $('#planOut');
  try {
    const ctx = window.TEAMCTX;
    if (!ctx || !ctx.squad || !ctx.squad.length) {
      out.innerHTML = '<div class="card"><p class="hint">Load your team in <b>My Team</b> first — the solver plans <b>your</b> squad, bank and free transfers.</p></div>';
      $('#chipOpt').innerHTML = '';
      return;
    }
    out.innerHTML = '<div class="card"><p class="hint">🧮 Solving your optimal transfers…</p></div>';
    const H = Math.max(1, Math.min(6, +$('#planHorizon').value || 4));
    const byName = {}; DATA.players.forEach(p => { byName[p.name] = p; });
    let squad = ctx.squad.map(s => DATA.players.find(p => p.id === s.r.element) || (s.e && byName[s.e.n])).filter(Boolean);
    if (squad.length < 11) {
      out.innerHTML = `<div class="card"><p class="hint">⚠️ Only matched <b>${squad.length}/15</b> of your squad to the player database — your team has players newer than this data snapshot. Reload <b>My Team</b> and try again, or ask the Copilot for transfer advice meanwhile.</p></div>`;
      $('#chipOpt').innerHTML = '';
      return;
    }
    const bank = ctx.bank || 0, ft = 1;
    const g = planGreedy(squad, bank, ft, H);
    // multi-period beam: looks across the WHOLE horizon, not just this week
    const b = H >= 2 ? planBeam(squad, bank, ft, H, { W: 5, K: 8 }) : g;
    const best = b.total >= g.total - 1e-9 ? b : g; // beam always contains the greedy path
    const rows = best.rows;
    const tot = best.total;
    const betterBy = b.total - g.total;
    const cmp = b !== g && betterBy > 0.05
      ? `<span class="mrow">🔭 Multi-period lookahead beat the greedy plan by <b class="up">+${betterBy.toFixed(1)}</b> projected pts (${b.total.toFixed(1)} vs ${g.total.toFixed(1)}) — it saw a move that only pays off in a later GW.</span>`
      : `<span class="mrow">🔭 ${H}-GW lookahead explored the whole horizon (beam ${b === g ? 'n/a' : 'searched'}); best plan ties the greedy baseline at <b>${tot.toFixed(1)}</b> projected pts — nothing on the horizon beats a simple path.</span>`;
    out.innerHTML = `<div class="card"><h2>🧾 Optimal ${H}-GW plan · projected ≈ ${tot.toFixed(1)} pts</h2>
    <table class="data"><tr><th>GW</th><th>Move</th><th>Captain</th><th class="num">Proj XI+cap</th><th>FT left</th></tr>
    ${rows.map(r => `<tr><td><b>GW${DATA.fplmeta.current_gw + 1 + r.gw}</b></td>
      <td>${r.act ? `<span class="down">− ${esc(r.act.out.name)}</span> → <span class="up">+ ${esc(r.act.inn.name)}</span>${r.hit ? ' <b class="down">(hit −4)</b>' : ''}` : 'Roll (save FT)'}</td>
      <td><b>${r.cap ? esc(r.cap.name) : '—'}</b></td><td class="num">${r.proj.toFixed(1)}</td><td class="num">${r.ft}</td></tr>`).join('')}
    </table>
    ${cmp}
    <p class="muted">Projections use the shared form-adjusted model (ep × adj FDR × home/away × minutes × reliability). Re-solve after every deadline — plans are dynamic, not promises.</p></div>`;
    chipOptimizer(best.squad, H);
  } catch (e) {
    console.error('[solvePlan]', e);
    out.innerHTML = `<div class="card"><p class="hint">⚠️ The solver hit an error: <b>${esc(e.message || e)}</b>.<br>Fix: reload your team in <b>My Team</b>, then press Solve again. If it persists, hard-refresh (Ctrl+Shift+R) to clear old cached files.</p></div>`;
    $('#chipOpt').innerHTML = '';
  }
}


function chipOptimizer(squad, H) {
  const chips = window.TEAMCTX ? window.TEAMCTX.chipsLeft : [];
  const cards = [];
  if (chips.includes('Triple Captain')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const st = startersAt(squad, i);
      const cap = st.slice().sort((a, b) => projP(b, i) - projP(a, i))[0];
      const bonus = cap ? projP(cap, i) : 0;
      if (!best || bonus > best.bonus) best = { i, cap, bonus };
    }
    if (best) cards.push(`<div class="ml-rival"><h4>🧨 Triple Captain</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> on <b>${esc(best.cap.name)}</b> (+${best.bonus.toFixed(1)} bonus pts) — but cross-check vs your Mini League mode: in DEFEND, TC the same player your rivals will captain.</div></div>`);
  }
  if (chips.includes('Bench Boost')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const s = squad.reduce((x, p) => x + projP(p, i), 0);
      if (!best || s > best.s) best = { i, s };
    }
    cards.push(`<div class="ml-rival"><h4>💪 Bench Boost</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> (all-15 projection ${best.s.toFixed(1)}) — ideally a week your bench plays FDR ≤3 and no blanks.</div></div>`);
  }
  if (chips.includes('Free Hit')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const fh = buildFH(i);
      const s = fh.reduce((x, p) => x + projP(p, i), 0);
      if (!best || s > best.s) best = { i, s, fh };
    }
    const gain = best.s - squad.reduce((x, p) => x + projP(p, best.i), 0);
    cards.push(`<div class="ml-rival"><h4>🎯 Free Hit</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> (+${Math.max(0, gain).toFixed(1)} over your XI). Draft: ${best.fh.slice(0, 6).map(p => esc(p.name)).join(', ')}…</div></div>`);
  }
  $('#chipOpt').innerHTML = cards.length ? `<div class="card"><h2>🃏 Chip Optimiser (over your horizon)</h2><div class="ml-grid">${cards.join('')}</div></div>` : '';
}
function buildFH(i) {
  const need = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const pick = [];
  const tc = {};
  const pool = DATA.players.filter(p => p.status === 'a').sort((a, b) => projP(b, i) - projP(a, i));
  for (const p of pool) {
    if (!need[p.pos]) continue;
    if ((tc[p.team] || 0) >= 3) continue;
    pick.push(p); tc[p.team] = (tc[p.team] || 0) + 1; need[p.pos]--;
    if (pick.length === 15) break;
  }
  return pick;
}

// ============ 🧪 BACKTEST LAB (audit #28/#29 · leakage-free honesty) ============
// Two evaluations, both strictly OUT-OF-SAMPLE — a prediction for GW g is built
// ONLY from GWs < g (rolling) or from other players' GWs + the player's own
// EARLIER GWs (leave-one-player-out). The lab never uses data that wouldn't
// have existed at prediction time. Results are labelled estimates; with GW1-3
// the lab is a pilot that grows into a true rolling backtest every deadline.
function btStarterRows() {
  // {id,pos,name} -> GW rows with >=60 mins are the "actually played" pool
  const byId = {};
  (DATA.players || []).forEach(p => { byId[p.id] = p; });
  const out = [];
  for (const idStr of Object.keys((DATA.history || {}))) {
    const p = byId[+idStr]; if (!p) continue;
    for (const r of DATA.history[idStr] || []) {
      if ((r[4] || 0) >= 60) out.push({ id: p.id, pos: p.pos, name: p.name, g: r[0], pts: r[1] || 0, mins: r[4] });
    }
  }
  return out;
}
// (A) leave-one-player-out calibration of P(>=6) — every starter GW is a test
// point; its prediction uses ONLY the position base rate built WITHOUT that
// player plus that player's own strictly-earlier GWs (shrunken).
function btOOF(opts) {
  const o = opts || {};
  const K = o.K || 2;                       // shrinkage strength (own sample)
  const rows = btStarterRows();
  const posTot = {}, pTot = {};
  rows.forEach(r => {
    const pt = posTot[r.pos] = posTot[r.pos] || { n: 0, r6: 0 };
    pt.n++; if (r.pts >= 6) pt.r6++;
    const pp = pTot[r.id] = pTot[r.id] || { n: 0, r6: 0, rows: [] };
    pp.n++; if (r.pts >= 6) pp.r6++; pp.rows.push(r);
  });
  const test = [];
  rows.forEach(r => {
    const tp = pTot[r.id];
    const earlier = tp.rows.filter(x => x.g < r.g);        // own strictly-earlier GWs only
    const e6 = earlier.filter(x => x.pts >= 6).length;
    const tot = posTot[r.pos] || { n: 0, r6: 0 };
    const exN = Math.max(0, tot.n - tp.n);                 // position pool WITHOUT this player
    const exR6 = Math.max(0, tot.r6 - tp.r6);
    const prior = exN ? 100 * exR6 / exN : 10;
    const w = earlier.length / (earlier.length + K);
    let pred = earlier.length ? w * (100 * e6 / earlier.length) + (1 - w) * prior : prior;
    pred = Math.max(1, Math.min(95, pred));
    test.push({ name: r.name, pos: r.pos, g: r.g, pred, y: r.pts >= 6 ? 1 : 0 });
  });
  const nT = test.length;
  const obsRate = nT ? 100 * test.reduce((a, x) => a + x.y, 0) / nT : 0;
  const mPred = nT ? test.reduce((a, x) => a + x.pred, 0) / nT : 0;
  let brier = 0, brierC = 0;
  test.forEach(x => { const p = x.pred / 100; brier += (p - x.y) * (p - x.y); const c = obsRate / 100; brierC += (c - x.y) * (c - x.y); });
  // calibration buckets by predicted band
  const bucket = {};
  test.forEach(x => { const band = Math.min(9, Math.floor(x.pred / 10)); const b = bucket[band] = bucket[band] || { n: 0, sum: 0, hits: 0 }; b.n++; b.sum += x.pred; b.hits += x.y; });
  const buckets = Object.keys(bucket).map(k => { const b = bucket[k]; return { band: +k * 10, n: b.n, predMean: b.sum / b.n, obs: 100 * b.hits / b.n }; }).sort((a, b) => a.band - b.band);
  const res = { nTotal: nT, observed: Math.round(obsRate * 10) / 10, meanPred: Math.round(mPred * 10) / 10,
    brier: Math.round(brier / nT * 10000) / 10000, brierConst: Math.round(brierC / nT * 10000) / 10000,
    buckets };
  if (o.raw) res.raw = test.map(x => ({ name: x.name, pos: x.pos, g: x.g, pred: Math.round(x.pred * 100) / 100, y: x.y }));
  return res;
}
// (B) time-series roll: predict GW g points purely from GWs < g (avg pts), then
// measure the correlation on players who actually started GW g. GW3 is the only
// honest pilot today; every deadline adds one more test GW.
function btRoll(g, opts) {
  const o = opts || {};
  const rows = btStarterRows();
  const hist = {};
  rows.forEach(r => { (hist[r.id] = hist[r.id] || []).push(r); });
  const pairs = [];
  rows.filter(r => r.g === g).forEach(r => {
    const prior = (hist[r.id] || []).filter(x => x.g < g);
    if (!prior.length) return;
    const pred = prior.reduce((a, x) => a + x.pts, 0) / prior.length;
    pairs.push({ pred, act: r.pts });
  });
  const n = pairs.length;
  if (n < 2) return { g, n, r: null, mae: null };
  const mP = pairs.reduce((a, x) => a + x.pred, 0) / n, mA = pairs.reduce((a, x) => a + x.act, 0) / n;
  let cov = 0, vP = 0, vA = 0, mae = 0;
  pairs.forEach(x => { cov += (x.pred - mP) * (x.act - mA); vP += (x.pred - mP) ** 2; vA += (x.act - mA) ** 2; mae += Math.abs(x.pred - x.act); });
  const r = (vP > 0 && vA > 0) ? cov / Math.sqrt(vP * vA) : 0;
  return { g, n, r: Math.round(r * 1000) / 1000, mae: Math.round(mae / n * 100) / 100, meanAct: Math.round(mA * 100) / 100 };
}
// honest calibration table for the UI
function btCalibTable(res) {
  if (!res || !res.nTotal) return '<p class="hint">No starter history yet — the lab fills in as gameweeks complete.</p>';
  const rows = res.buckets.map(b => {
    const drift = b.obs - b.predMean;
    const tag = Math.abs(drift) <= 7 ? '<span style="color:var(--green)">✓ calibrated</span>' : (drift > 7 ? '<span style="color:var(--amber)">under-predicted</span>' : '<span style="color:var(--red)">over-predicted</span>');
    return `<tr><td>${b.band}–${Math.min(99, b.band + 9)}%</td><td class="num">${b.n}</td><td class="num">${b.predMean.toFixed(0)}%</td><td class="num"><b>${b.obs.toFixed(0)}%</b></td><td>${tag}</td></tr>`;
  }).join('');
  const skill = res.brier <= res.brierConst ? '✔ out-of-sample Brier is <b>better</b> than always predicting the base rate' : '✘ the base rate alone beat the model out-of-sample (narrow sample — keep accumulating)';
  return `<div class="card" style="grid-column:1/-1"><h2>🎯 (A) Return-chance calibration — leave-one-player-out</h2>
    <p class="muted">For every starter GW in GW1–${(DATA.fplmeta && DATA.fplmeta.current_gw) || 3}, the model predicted P(≥6) using ONLY data available beforehand (position base rate minus that player + his own earlier GWs). Then we checked: did ~X% of the "30%" group actually return? <b>${res.nTotal} player-GWs</b>, observed return rate <b>${res.observed}%</b>, mean predicted ${res.meanPred}%.</p>
    <div style="overflow-x:auto"><table class="data compact"><tr><th>Predicted band</th><th class="num">n</th><th class="num">Mean predicted</th><th class="num">Actually returned</th><th>Verdict</th></tr>${rows}</table></div>
    <p class="muted" style="margin-top:6px">${skill} · Brier ${res.brier.toFixed(4)} vs baseline ${res.brierConst.toFixed(4)}. This is a GW1-3 pilot — the table becomes trustworthy as each deadline adds real test GWs.</p></div>`;
}
// P3 polish: compact weekly Lab digest shown on the Overview — last GW's honest
// verdicts at a glance (return-chance calibration, rolling test, decision matrix).
function labDigestHtml() {
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const res = btOOF({ K: 2 });
  const roll = cur > 1 ? btRoll(cur) : null;
  const calib = (res && res.nTotal)
    ? (Math.abs(res.observed - res.meanPred) <= 7
        ? `<span class="xb" style="--c:var(--green)">✓ well calibrated</span>`
        : `<span class="xb" style="--c:var(--amber)">calibration drifting</span>`)
    : 'awaiting first test GW';
  const skill = (res && res.nTotal)
    ? (res.brier < res.brierConst
        ? '<span class="xb" style="--c:var(--green)">model edges the baseline</span>'
        : '<span class="xb" style="--c:var(--amber)">baseline still wins — keep accumulating</span>')
    : '';
  const rollTxt = roll && roll.n >= 60
    ? `form→next-GW r = <b>${roll.r}</b> (n=${roll.n}) — ${Math.abs(roll.r) < 0.12 ? 'a single GW of form barely predicts the next, as expected this early' : 'a genuine signal is emerging'}.`
    : roll ? `GW${roll.g} rolling test needs more starters (n=${roll.n}).` : 'rolling test pending more GWs.';
  let ldTxt = '';
  try { if (typeof ldStats === 'function') { const st = ldStats(); ldTxt = st.rate != null
      ? `Decision matrix: <b>${st.done.length}</b> resolved (${st.win}W/${st.loss}L) → model win-rate <b>${st.rate}%</b>.`
      : `Decision matrix: logging starts GW${cur + 1} — <b>${st.pending}</b> verdict${st.pending === 1 ? '' : 's'} already queued to self-audit.`; } } catch (e) { }
  const stat = (v, k) => `<div class="dq"><b>${v}</b><span>${k}</span></div>`;
  return `<div class="card x-card" style="grid-column:1/-1"><h2 style="margin-bottom:2px">🧪 Weekly Lab digest <span class="muted">— GW${cur} verdict, in plain words</span></h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px" class="x-dq">
      ${stat(res && res.nTotal ? res.observed + '%' : '—', 'players actually returned')}
      ${stat(res && res.nTotal ? res.meanPred + '%' : '—', 'mean predicted chance')}
      ${stat(calib, 'return-chance calibration')}
      ${stat(skill || (res ? res.brier.toFixed(3) : '—'), 'out-of-sample Brier')}
    </div>
    <p class="muted" style="margin:8px 0 0">${rollTxt}</p>
    <p class="muted" style="margin:4px 0 0">${ldTxt || ''}</p>
    <p class="muted" style="margin:4px 0 0">Everything here is out-of-sample and labelled — GW1-${cur} is a pilot; the Lab tab (📅 Planner) has the full method and tables. ${skill ? '' : ''}</p></div>`;
}
function renderLabDigest() {
  const el = $('#labDigest'); if (!el) return;
  try { el.innerHTML = labDigestHtml(); } catch (e) { console.error('[labDigest]', e); el.innerHTML = ''; }
}

// ============ 📏 xP MEASUREMENT (audit M3 · v31) ============
// projP was never backtested against official FPL ep_next, because a retro test
// leaks (no historical ep snapshots). Fix: a FORECAST LEDGER records, once per
// gameweek, the model xP AND the official ep for every player for the open GW.
// When that GW's real results land, fxBench() scores both against actual points
// (MAE + correlation) with no leakage. Deterministic + local.
const FL_KEY = 'fxledger_v1';
function flGet() { try { return JSON.parse(localStorage.getItem(FL_KEY)) || {}; } catch (e) { return {}; } }
function flSet(o) { try { localStorage.setItem(FL_KEY, JSON.stringify(o)); } catch (e) { } }
function flOpenGw() { return ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1; }
function fxLedgerRecord() {
  try {
    if (!DATA.players || !DATA.players.length) return;
    const g = flOpenGw();
    const led = flGet();
    if (led[g]) return;
    const snap = {};
    for (const p of DATA.players) {
      const f = (typeof forecastOf === 'function') ? forecastOf(p) : null;
      if (!f) continue;
      snap[p.id] = { xp: f.xp, ep: Math.round((p.ep_next || 0) * 10) / 10, p6: f.p6 };
    }
    led[g] = { n: Object.keys(snap).length, snap };
    Object.keys(led).forEach(k => { if (Number(k) < g - 5) delete led[k]; });
    flSet(led);
  } catch (e) { console.error('[fxLedger]', e); }
}
function fxBench() {
  const led = flGet();
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const hist = DATA.history || {};
  const act = {};
  for (const idStr of Object.keys(hist)) for (const r of hist[idStr] || []) {
    if (r[0] === cur) act[idStr] = (act[idStr] || 0) + (r[1] || 0);
  }
  if (!led[cur] || !Object.keys(act).length) return { g: cur, n: 0 };
  const M = [], O = [];
  const snap = led[cur].snap || {};
  for (const idStr of Object.keys(act)) {
    const f = snap[idStr]; if (!f) continue;
    const y = act[idStr];
    M.push([f.xp, y]); O.push([f.ep, y]);
  }
  const n = M.length;
  const stat = arr => {
    if (n < 2) return { n, mae: null, r: null, mP: null, mA: null };
    const mP = arr.reduce((a, x) => a + x[0], 0) / n, mA = arr.reduce((a, x) => a + x[1], 0) / n;
    let cov = 0, vP = 0, vA = 0, mae = 0;
    arr.forEach(x => { cov += (x[0] - mP) * (x[1] - mA); vP += (x[0] - mP) ** 2; vA += (x[1] - mA) ** 2; mae += Math.abs(x[0] - x[1]); });
    return { n, mae: Math.round(mae / n * 100) / 100, r: vP > 0 && vA > 0 ? Math.round(cov / Math.sqrt(vP * vA) * 1000) / 1000 : null, mP: Math.round(mP * 100) / 100, mA: Math.round(mA * 100) / 100 };
  };
  return { g: cur, n, model: stat(M), ep: stat(O), ledN: (led[cur] && led[cur].n) || 0 };
}
function btXpCard() {
  const g = flOpenGw();
  const b = fxBench();
  if (!b.n) {
    const prev = flGet()[flOpenGw() - 1];
    const rec = prev && prev.n;
    return `<div class="card" style="grid-column:1/-1"><h2>📏 xP vs official — forecast ledger</h2>
      <p class="hint">The core xP model is never backtested retroactively (that would leak — no historical ep snapshots exist). So since v31 every open GW's <b>model xP and official FPL ep</b> are recorded for every player, once. The first measurement publishes itself here as soon as GW${g} has real results.</p>
      <p class="muted">Ledger armed${rec ? ' — GW' + (g - 1) + ': ' + rec + ' players recorded, awaiting GW' + g + ' results' : ' (first snapshot happens now)'}. Same honesty loop as the decision ledger: record, then measure, then publish.</p></div>`;
  }
  const model = b.model, ep = b.ep;
  const better = (model.mae != null && ep.mae != null) ? (model.mae < ep.mae ? 'model <b>leads</b>' : ep.mae < model.mae ? 'official ep <b>leads</b>' : 'level') : 'n/a';
  return `<div class="card" style="grid-column:1/-1"><h2>📏 xP vs official — GW${b.g} measured</h2>
    <table style="width:100%;border-collapse:collapse"><tr><th>predictor</th><th class="num">MAE</th><th class="num">corr r</th></tr>
    <tr><td><b>our model xP</b></td><td class="num">${model.mae == null ? 'n/a' : model.mae}</td><td class="num">${model.r == null ? 'n/a' : model.r}</td></tr>
    <tr><td>official FPL ep</td><td class="num">${ep.mae == null ? 'n/a' : ep.mae}</td><td class="num">${ep.r == null ? 'n/a' : ep.r}</td></tr></table>
    <p class="muted">n=${model.n} starters · mean predicted ${model.mP} vs actual ${model.mA} · ${better}${model.n < 120 ? ' <span class="xb" style="--c:var(--amber)">pilot — not yet significant</span>' : ''}. Honest rule: if the model can't beat official ep, we simplify it.</p></div>`;
}

function renderBacktest() {
  const el = $('#btOut'); if (!el) return;
  try {
    const res = btOOF({ K: 2 });
    const rolls = [];
    const maxG = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
    for (let g = 2; g <= maxG; g++) rolls.push(btRoll(g));
    const rollCards = rolls.map(ro => {
      if (!ro.n) return '';
      const honest = ro.n < 120 ? ' <span class="xb" style="--c:var(--amber)">pilot — not yet significant</span>' : '';
      return `<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:8px 10px">
        <b>GW${ro.g}</b> (trained on GW1–${ro.g - 1})<br><span class="muted">correlation r = </span><b>${ro.r == null ? 'n/a' : ro.r}</b>${honest}<br><span class="muted">MAE ${ro.mae == null ? 'n/a' : ro.mae} pts · n=${ro.n} starters</span></div>`;
    }).join('');
    const multi = maxG >= 4 ? `<p class="muted">Rolling backtest active: ${maxG - 1} test GWs now.</p>` : '';
    el.innerHTML = `<div class="card" style="grid-column:1/-1"><h2>🧪 Backtest Lab <span class="muted">— does the model actually predict?</span></h2>
      <p class="hint">Every number here is out-of-sample: a GW${maxG} prediction was built without seeing GW${maxG}. The lab is honest by design — it will happily tell you the model is <b>not</b> yet proven. GW1–3 is a pilot; after each deadline it grows into a real rolling backtest.</p></div>
      ${btCalibTable(res)}
      <div class="card" style="grid-column:1/-1"><h2>⏱️ (B) Rolling GW test <span class="muted">— predict GW g from GWs &lt; g only</span></h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">${rollCards || '<p class="muted">—</p>'}</div>
      ${multi}
            ${btXpCard()}
      <p class="muted" style="margin-top:4px">Caveat: a single GW of "form" is a weak predictor of the next GW (soccer is noisy). A correlation near 0 at this stage is the <b>expected honest result</b>, not a bug — the lab exists to measure it, and each week adds power.</p></div>`;
  } catch (e) { console.error('[backtest]', e); el.innerHTML = ''; }
}

const CMP_COLORS = ['#00ff85', '#4dc3ff', '#c792ea'];

function cmpChartSVG(ps, H) {
  const gw0 = DATA.fplmeta.current_gw + 1;
  const series = ps.map(p => { const v = []; for (let i = 0; i < H; i++) v.push(projP(p, i)); return v; });
  const rawMax = Math.max(...series.flat(), 1);
  const p10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const nn = rawMax / p10;
  const ymax = (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * p10;
  const W = 760, Hpx = 300, PL = 46, PR = 14, PT = 16, PB = 66;
  const X = i => PL + (W - PL - PR) * (H === 1 ? 0.5 : i / (H - 1));
  const Y = v => PT + (Hpx - PT - PB) * (1 - v / ymax);
  let g = '';
  for (let t = 0; t <= 4; t++) {
    const v = ymax * t / 4, y = Y(v);
    g += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,${t === 0 ? 0.25 : 0.08})" stroke-width="1"/>`;
    g += `<text x="${PL - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#8a93a6">${v.toFixed(1)}</text>`;
  }
  for (let i = 0; i < H; i++) {
    const x = X(i);
    g += `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${Hpx - PB}" stroke="rgba(255,255,255,0.05)"/>`;
    g += `<text x="${x.toFixed(1)}" y="${Hpx - PB + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="#e8ecf4">GW${gw0 + i}</text>`;
    ps.forEach((p, k) => {
      const f = (p.next3 || [])[i];
      g += `<text x="${x.toFixed(1)}" y="${Hpx - PB + 32 + k * 12}" text-anchor="middle" font-size="10.5" fill="${CMP_COLORS[k]}">${f ? `${f.opp}(${f.ha}) ·${f.afdr ?? f.fdr}` : '—'}</text>`;
    });
  }
  const win = [];
  for (let i = 0; i < H; i++) { let bi = 0; series.forEach((s, k) => { if (s[i] > series[bi][i]) bi = k; }); win.push(bi); }
  series.forEach((s, k) => {
    const pts = s.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const c = CMP_COLORS[k];
    g += `<polygon points="${PL},${Y(0).toFixed(1)} ${pts} ${X(H - 1).toFixed(1)},${Y(0).toFixed(1)}" fill="${c}" opacity="0.10"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.forEach((v, i) => {
      const best = win[i] === k;
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${best ? 5 : 3.5}" fill="#0d1117" stroke="${best ? '#ffd166' : c}" stroke-width="${best ? 3 : 2.5}"><title>${esc(ps[k].name)} GW${gw0 + i}: ${v.toFixed(1)} pts${best ? ' ★ best' : ''}</title></circle>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${Hpx}" style="width:100%;height:auto;display:block;background:rgba(255,255,255,.02);border-radius:10px" role="img"><title>Projected points per gameweek</title>${g}</svg>`;
}

// P2/P3 polish: full next-GW outcome-spread comparison chart (probability, not a point)
function distCompareCard(ps) {
  const bands = [['≤0', '#5a6a85'], ['1–2', '#7a8bb0'], ['3–5', '#e6a23c'], ['6–9', '#4cd964'], ['10+', '#2dd4a7']];
  const rows = ps.map(p => {
    const D = distOf(p);
    const bar = D.prob.map((x, i) =>
      `<div style="flex:${Math.max(1, Math.round(x * 1000))};background:${bands[i][1]};min-width:${x > 0.04 ? 16 : 2}px;height:15px" title="${bands[i][0]}: ${Math.round(x * 100)}%"></div>`).join('');
    const pct = D.prob.map((x, i) =>
      `<span class="tk-opp" style="min-width:58px">${bands[i][0]} <b>${Math.round(x * 100)}%</b></span>`).join('');
    return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(p.name)}</b>
      <span class="muted">mid ≈ ${D.mean.toFixed(1)} · haul ${Math.round(D.prob[4] * 100)}% · blank ${Math.round(D.prob[0] * 100)}%</span></div>
      <div style="display:flex;gap:2px;height:15px;border-radius:3px;overflow:hidden;margin:5px 0;background:rgba(255,255,255,.06)">${bar}</div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap">${pct}</div></div>`;
  }).join('');
  const legend = bands.map(b => `<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${b[1]};margin-right:4px;vertical-align:middle"></span>${b[0]} pts</span>`).join('');
  return `<div class="card" style="grid-column:1/-1"><h2>🎲 Next-GW outcome spread <span class="muted">— the probability shape, not a single number</span></h2>
    <div class="muted" style="margin:2px 0 4px">${legend}</div>${rows}
    <p class="muted" style="margin:4px 0 0">Bars always total 100% and the 6–9 + 10+ tails equal P(≥6)/P(≥10). "Mid" = probability-weighted expectation from real GW1-${(DATA.fplmeta && DATA.fplmeta.current_gw) || 3} results. Compare <b>shapes</b>: right-shifted = steady returns + real hauls; squat &amp; low = frequent blanks. Model estimate — not a promise.</p></div>`;
}

function renderCompare() {
  const pick = id => findPlayer(($('#' + id).value || '').toLowerCase());
  const ps = [pick('cmpA'), pick('cmpB'), pick('cmpC')].filter(Boolean);
  const uniq = [...new Map(ps.map(p => [p.id, p])).values()];
  if (uniq.length < 2) { $('#cmpOut').innerHTML = '<p class="hint">Type two player names (autocomplete helps) and hit Compare.</p>'; return; }
  const H = 5, gw0 = DATA.fplmeta.current_gw + 1;
  const totals = uniq.map(p => { let s = 0; for (let i = 0; i < H; i++) s += projP(p, i); return s; });
  const order = uniq.map((p, k) => k).sort((a, b) => totals[b] - totals[a]);
  const wins = uniq.map(() => 0);
  for (let i = 0; i < H; i++) { let bi = 0; uniq.forEach((p, k) => { if (projP(p, i) > projP(uniq[bi], i)) bi = k; }); wins[bi]++; }
  const fdrChip = f => f ? `<span class="fdr f${f.afdr ?? f.fdr}">${f.afdr ?? f.fdr}</span>` : '';
  const heads = uniq.map((p, k) => `
    <div class="ml-rival" style="border-top:3px solid ${CMP_COLORS[k]};min-width:220px">
      <h4><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CMP_COLORS[k]};margin-right:6px"></span>${esc(p.name)} ${posBadge(p.pos)}</h4>
      <div class="gapline">${p.team} · £${p.cost}m · ${p.own}% owned · team form #${formRank(p)}</div>
      <div class="gapline">${p.pts} pts · ${p.g}G ${p.a}A · xG ${p.xg} xA ${p.xa} · ${p.mins}&prime;</div>
      <div class="gapline">Reliability <b>${Math.round(reliab(p) * 100)}%</b> · next-5 <b style="color:${CMP_COLORS[k]}">${totals[k].toFixed(1)}</b> · GW wins <b>${wins[k]}/5</b></div>
      <div class="gapline">🎲 P(≥6) <b style="color:${playerProb(p).p6 >= 40 ? 'var(--green)' : playerProb(p).p6 >= 20 ? 'var(--amber)' : 'var(--red)'}">${playerProb(p).p6}%</b> · P(≥10) <b>${playerProb(p).p10}%</b> · swing ±${playerProb(p).sd.toFixed(1)}/GW <span class="tk-opp">(chance ≠ xPts)</span></div>
      <div style="margin-top:6px">${sparkSVG(p.id, 220, 36)}</div>
    </div>`).join('');
  const gwRows = Array.from({ length: H }, (_, i) => {
    let bi = 0; uniq.forEach((p, k) => { if (projP(p, i) > projP(uniq[bi], i)) bi = k; });
    return `<tr><td><b>GW${gw0 + i}</b></td>` + uniq.map((p, k) => {
      const f = (p.next3 || [])[i];
      return `<td class="num" style="${k === bi ? 'background:rgba(255,209,102,.12);font-weight:700' : ''}">${projP(p, i).toFixed(1)}${k === bi ? ' ★' : ''}<br><span class="tk-opp">${f ? `${f.opp}(${f.ha})` : '—'} ${fdrChip(f)}</span></td>`;
    }).join('') + '</tr>';
  }).join('');
  const METRICS = [
    ['Form', p => p.form || 0, 1, ''], ['ep next', p => p.ep_next || 0, 1, ''],
    ['Season pts', p => p.pts || 0, 0, ''], ['xG + xA', p => (p.xg || 0) + (p.xa || 0), 2, ''],
    ['Minutes', p => p.mins || 0, 0, ''], ['Own %', p => p.own || 0, 1, '%'],
    ['Price', p => p.cost || 0, 1, 'm'], ['Reliability', p => reliab(p) * 100, 0, '%'],
  ];
  const bars = METRICS.map(([label, fn, dec, unit]) => {
    const vals = uniq.map(fn), mx = Math.max(...vals, 0.0001);
    return `<div class="cmp-metric"><div class="cmp-mlabel">${label}</div>` + uniq.map((p, k) => `
      <div class="cmp-mrow"><span class="cmp-mname" style="color:${CMP_COLORS[k]}">${esc(p.name)}</span>
      <div class="cmp-mtrack"><div class="cmp-mfill" style="width:${(100 * vals[k] / mx).toFixed(1)}%;background:${CMP_COLORS[k]}"></div></div>
      <span class="cmp-mval">${vals[k].toFixed(dec)}${unit}</span></div>`).join('') + '</div>';
  }).join('');
  const a = uniq[order[0]], b = uniq[order[1]], edge = totals[order[0]] - totals[order[1]];
  $('#cmpOut').innerHTML = `<div class="ml-grid" style="grid-column:1/-1">${heads}</div>
    <div class="card" style="grid-column:1/-1"><h2>📈 Projected points — next 5 gameweeks</h2>
    <div class="cmp-legend">${uniq.map((p, k) => `<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${CMP_COLORS[k]};margin-right:5px"></span><b>${esc(p.name)}</b> <span class="muted">${totals[k].toFixed(1)} pts</span></span>`).join('')}</div>
    ${cmpChartSVG(uniq, H)}
    <p class="muted" style="margin:6px 0 0">Fixture under each GW (number = difficulty) · gold ring = model's best that week · hover dots for values.</p></div>
    ${distCompareCard(uniq)}
    <div class="card" style="grid-column:1/-1"><h2>📆 Gameweek breakdown <span class="muted">— ★ = model's pick each week</span></h2>
    <div style="overflow-x:auto"><table class="data"><tr><th></th>${uniq.map((p, k) => `<th class="num"><span style="color:${CMP_COLORS[k]}">●</span> ${esc(p.name)}</th>`).join('')}</tr>
    ${gwRows}<tr><td><b>Total</b></td>${uniq.map((p, k) => `<td class="num"><b style="color:${CMP_COLORS[k]}">${totals[k].toFixed(1)}</b></td>`).join('')}</tr></table></div></div>
    <div class="card" style="grid-column:1/-1"><h2>📊 Head-to-head numbers</h2><div class="cmp-metrics">${bars}</div></div>
    <div class="card" style="grid-column:1/-1"><h2>🤖 Verdict</h2>
    <p><b style="color:${CMP_COLORS[order[0]]}">${esc(a.name)}</b> by <b>+${edge.toFixed(1)}</b> projected pts over the next 5 (${totals[order[0]].toFixed(1)} vs ${totals[order[1]].toFixed(1)}), winning <b>${wins[order[0]]}/5</b> gameweeks on fixtures × form × reliability.</p>
    <p class="muted">${reliab(a) >= reliab(b) ? `${esc(a.name)}'s returns are also more reliable (${Math.round(reliab(a) * 100)}% vs ${Math.round(reliab(b) * 100)}%) — underlying xGI backs the output.` : `Note: ${esc(b.name)} is the more reliable pick (${Math.round(reliab(b) * 100)}% vs ${Math.round(reliab(a) * 100)}%) — ${esc(a.name)}'s edge leans on fixtures; weigh floor vs ceiling.`}${ML.ready ? ` Mini-league: ${ML.ownCount(a)}/${ML.n} rivals own ${esc(a.name)} vs ${ML.ownCount(b)}/${ML.n} for ${esc(b.name)}.` : ''}</p>
    <p class="muted">P(≥6) / P(≥10) chips answer "how likely is a return/haul?" — calibrated from real GW1-${DATA.fplmeta ? DATA.fplmeta.current_gw : 3} results (league base rate by position blended with each player's own record). A probability is not a point prediction.</p></div>`;
}


// ============ 🧠 ELITE MANAGER TRENDS MODULE ============
// ============================================================================
// 🧠 ELITE MANAGER TRENDS — real evidence from the official FPL API
// Data source: api/elite.json (built by elite_ingest.py from
// fantasy.premierleague.com — real public entries, no simulations).
// Every number below traces to a real named team you can open on FPL.
// ============================================================================
const ET = (() => {
  let ok = false, D = {};
  const FOLD = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cache = { agg: null, rows: null, playerById: null, skill: null };

  function pById() {
    if (!cache.playerById) {
      cache.playerById = {};
      (D.players || []).forEach(p => { cache.playerById[p.id] = p; });
    }
    return cache.playerById;
  }
  const P = id => pById()[id] || null;

  // latest completed GW + open GW from feed meta
  function gws() {
    const m = D.elite.meta || {};
    return { last: m.latest_complete || '3', open: m.open_gw || String(+(m.latest_complete || 3) + 1),
             cohort: m.cohort || 0, next: m.next_update_after || '' };
  }
  function gwAgg(g) { return (D.elite.gw || {})[String(g)] || { own: {}, cap: {}, bought: {}, sold: {}, n: 0 }; }

  // one merged row per player for the LATEST completed GW
  function rows() {
    if (cache.rows) return cache.rows;
    const { last } = gws();
    const g = gwAgg(last);
    const prevG = gwAgg(String(+(last) - 1));
    const byId = {};
    (D.players || []).forEach(p => byId[p.id] = p);
    const out = [];
    const ids = new Set([...Object.keys(g.own), ...Object.keys(g.bought), ...Object.keys(g.sold), ...Object.keys(g.cap)]);
    ids.forEach(id => {
      const p = byId[id]; if (!p) return;
      const n = g.n || 1;
      const own = g.own[id] || 0, ownPrev = prevG.own[id] || 0;
      const bought = g.bought[id] || 0, sold = g.sold[id] || 0;
      const net = bought - sold;
      const cap = g.cap[id] || 0;
      const deltaOwn = own - ownPrev;
      const eliteShare = Math.round(100 * own / n);
      const row0 = { id, name: p.name, pos: p.pos, team: p.team, cost: p.cost,
        own_pub: p.own || 0, own_elite: own, own_elite_prev: ownPrev,
        share: eliteShare, delta: deltaOwn, bought, sold, net, cap,
        capShare: Math.round(100 * cap / n),
        ep: p.ep_next || 0, form: p.form || 0, mins: p.mins || 0,
        fx: adjFDR(p), status: p.status || 'a' };
      row0.bought = bought; row0.sold = sold; row0.net = net; row0.cap = cap;
      row0.delta = deltaOwn; row0.share = eliteShare;
      row0.own_pub = p.own || 0; row0.own_elite = own; row0.own_elite_prev = ownPrev;
      row0.capShare = Math.round(100 * cap / n);
      row0.cls = classify(row0);
      out.push(row0);
    });
    out.sort((a, b) => (Math.abs(b.net) * 3 + b.cap * 2 + Math.abs(b.delta)) - (Math.abs(a.net) * 3 + a.cap * 2 + Math.abs(a.delta)));
    cache.rows = out;
    return out;
  }
  function adjFDR(p) {
    const TF = D.teamsByShort || {}; const t = TF[p.team]; if (!t || !t.afx) return 3;
    const f = (p.next3 || []).map((x, i) => { const v = (t.afx[i] != null) ? t.afx[i] : x.fdr; return Math.max(1, Math.min(5, v)); });
    return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 3;
  }
  // classifier — from REAL ownership/movement only
  function classify(r) {
    if (r.sold >= 8 && r.bought <= 2) return r.share >= 50 ? 'Faded template (elites selling)' : 'Sold by elites';
    if (r.bought >= 8 && r.net >= 8) return r.share >= 50 ? 'Elite template core' : 'Entering elite template';
    if (r.bought >= 3 && r.share < 25) return 'Rising elite differential';
    if (r.share >= 60 && r.net >= -2) return 'Elite template core';
    if (r.own_pub >= 30 && r.share < 20 && r.net <= -3) return 'Avoided by elites (public favourite)';
    if (r.share >= 40) return 'Elite template';
    return 'Held by few elites';
  }
  function cls(r) {
    if (r.sold >= 8 && r.bought <= 2) return r.share >= 50 ? 'Faded template (elites selling)' : 'Sold by elites';
    if (r.bought >= 8 && r.net >= 8) return r.share >= 50 ? 'Elite template core' : 'Entering elite template';
    if (r.bought >= 3 && r.share < 25) return 'Rising elite differential';
    if (r.share >= 60 && r.net >= -2) return 'Elite template core';
    if (r.own_pub >= 30 && r.share < 20 && r.net <= -3) return 'Avoided by elites (public favourite)';
    if (r.share >= 40) return 'Elite template';
    return 'Held by few elites';
  }
  function captainGW(g) {
    const a = gwAgg(g); const cap = a.cap || {};
    const n = a.n || 1;
    return Object.keys(cap).map(id => ({ id, n: cap[id], share: Math.round(100 * cap[id] / n) }))
      .sort((x, y) => y.n - x.n);
  }
  function templateGW(g) {
    // real squad template: players present in >=40% of elite squads at GW g
    const a = gwAgg(g); const n = a.n || 1;
    const pos = { GK: [], DEF: [], MID: [], FWD: [] };
    Object.keys(a.own).forEach(id => {
      const p = P(id); if (!p || !pos[p.pos]) return;
      const c = a.own[id];
      if (c / n >= 0.35) pos[p.pos].push({ name: p.name, team: p.team, c, share: Math.round(100 * c / n), cls: 'template' });
    });
    Object.keys(a.own).forEach(id => {
      const p = P(id); if (!p || !pos[p.pos]) return;
      const c = a.own[id];
      const b = a.bought[id] || 0;
      if (c / n < 0.35 && b >= 6) pos[p.pos].push({ name: p.name, team: p.team, c, share: Math.round(100 * c / n), cls: 'rising' });
    });
    const order = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
    Object.keys(pos).forEach(k => pos[k].sort((x, y) => (order[x.cls] || 9) - (order[y.cls] || 9) || y.share - x.share));
    return pos;
  }
  // honest note text, no invented "why"
  function dataNote(r) {
    const parts = [];
    if (r.fx <= 2.4) parts.push(`next fixtures avg ${r.fx.toFixed(1)} (kind)`);
    else if (r.fx >= 3.4) parts.push(`next fixtures avg ${r.fx.toFixed(1)} (tough)`);
    if (r.ep >= 7) parts.push(`GW model ${r.ep.toFixed(1)} pts`); else if (r.ep <= 3) parts.push(`GW model ${r.ep.toFixed(1)} pts`);
    if (r.mins >= 260) parts.push(`played ${r.mins}/270 mins`); else if (r.mins <= 120) parts.push(`only ${r.mins} mins so far`);
    return parts.join(' · ') || '—';
  }
  // ---------- quality weighting (audit roadmap #16) ----------
  // Skill weight from REAL past-season overall ranks only (never the current
  // hot streak): top-1k finish ×2.0 · top-10k ×1.5 · top-100k ×1.2 · else ×0.6.
  // Purpose: an experienced manager's transfer/captain should count more than a
  // first-season lucky leader's. Labelled model — never a claim about intent.
  function skillRow(e) {
    const past = e.past || [];
    const ranks = past.map(s => +s.rank).filter(r => isFinite(r) && r >= 1 && r < 5e7);
    const nTop1k = ranks.filter(r => r <= 1000).length;
    const nTop10k = ranks.filter(r => r <= 10000).length;
    const nTop100k = ranks.filter(r => r <= 100000).length;
    const best = ranks.length ? Math.min.apply(null, ranks) : (e.best_rank || null);
    const w = nTop1k ? 2 : nTop10k ? 1.5 : nTop100k ? 1.2 : 0.6;
    return { entry: e.entry, name: e.player_name || e.entry_name || String(e.entry),
      pastN: ranks.length, nTop1k, nTop10k, nTop100k, best, w,
      tier: nTop1k ? 'proven top-1k' : nTop10k ? 'proven top-10k' : nTop100k ? 'top-100k' : 'newcomer' };
  }
  function skill() {
    if (!cache.skill) cache.skill = (D.elite.elites || []).map(skillRow);
    return cache.skill;
  }
  function skillW() { const m = {}; skill().forEach(s => { m[s.entry] = s.w; }); return m; }
  // skill-weighted captaincy for a GW (every manager's real armband is in elites[].captains)
  function capSkill(g) {
    const sw = skillW();
    const acc = {}; let wsum = 0, rawN = 0;
    (D.elite.elites || []).forEach(e => {
      const c = (e.captains || {})[String(g)]; if (!c) return;
      const w = sw[e.entry] || 0.6; wsum += w; rawN++;
      const o = acc[c] = acc[c] || { w: 0, raw: 0 }; o.w += w; o.raw++;
    });
    return Object.keys(acc).map(id => ({ id, n: acc[id].raw, share: rawN ? Math.round(100 * acc[id].raw / rawN) : 0,
      wN: Math.round(acc[id].w * 10) / 10, wShare: wsum ? Math.round(100 * acc[id].w / wsum) : 0 }))
      .sort((a, b) => b.wN - a.wN);
  }
  // skill-weighted transfers for a GW (real transfer records in elites[].transfers, event = gw)
  function churnSkill(g) {
    const sw = skillW();
    const b = {}, s = {}; let rawT = 0;
    const ev = Number(g);
    (D.elite.elites || []).forEach(e => {
      (e.transfers || []).filter(t => Number(t.event) === ev).forEach(t => {
        const w = sw[e.entry] || 0.6; rawT++;
        if (t.element_in) { const o = b[t.element_in] = b[t.element_in] || { w: 0, raw: 0 }; o.w += w; o.raw++; }
        if (t.element_out) { const o = s[t.element_out] = s[t.element_out] || { w: 0, raw: 0 }; o.w += w; o.raw++; }
      });
    });
    const mk = o => Object.keys(o).map(id => ({ id, n: o[id].raw, wN: Math.round(o[id].w * 10) / 10 }))
      .sort((x, y) => y.wN - x.wN);
    return { bought: mk(b), sold: mk(s), rawT };
  }
  // ---------- public ----------
  const api = {
    init(data) {
      D = data || {};
      D.elite = D.elite || { meta: {}, elites: [], gw: {}, transfers: {} };
      D.teamsByShort = {};
      (D.teams || []).forEach(t => { D.teamsByShort[t.short] = t; });
      cache.agg = null; cache.rows = null; cache.playerById = null;
      ok = true; return api;
    },
    ready() { return ok; },
    data: () => D,
    gws, gwAgg, P,
    rows: () => { api._ensure(); return rows(); },
    classify: (r) => classify(r),
    cls: (r) => cls(r),
    captainGW: (g) => { api._ensure(); return captainGW(g); },
    templateGW: (g) => { api._ensure(); return templateGW(g); },
    skill: () => { api._ensure(); return skill(); },
    skillW: () => { api._ensure(); return skillW(); },
    capSkill: (g) => { api._ensure(); return capSkill(g); },
    churnSkill: (g) => { api._ensure(); return churnSkill(g); },
    dataNote: (r) => dataNote(r),
    cohortMeta() {
      api._ensure();
      const es = D.elite.elites || [];
      const proven = es.filter(e => e.proven_top10k).length;
      const top10 = es.filter(e => e.best_rank && e.best_rank <= 1000).length;
      return { n: es.length, proven, top10,
        verified: es.filter(e => e.best_rank).length, g: gws() };
    },
    _ensure() { if (!ok) api.init(typeof DATA !== 'undefined' ? DATA : {}); },
  };
  return api;
})();

// ============================================================================
// 🧠 ELITE MANAGER TRENDS — renderer & NL (real evidence only)
// ============================================================================
const eh = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function eBar(pct, color) {
  const p = Math.max(2, Math.min(100, pct || 0));
  return `<div class="x-bar"><div class="x-fill" style="width:${p}%;background:${color || 'var(--green)'}"></div></div>`;
}
function ePos(p) { return `<span class="pos ${p}">${p}</span>`; }
function eCls(c) { return `<span class="xb" style="--c:#9f7bff">${eh(c)}</span>`; }
function eLink(id) { return `https://fantasy.premierleague.com/entry/${id}/history`; }

// ---------- header: real-data quality strip ----------
function eliteDq() {
  const m = ET.cohortMeta(); const g = m.g;
  const real = g.last;
  const link = eLink;
  return `<div class="card x-card">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">
      <div>
        <h2 style="margin-bottom:4px">🧠 Elite Manager Trends <span class="muted">— what the world's best managers <b>actually do</b> · real official FPL data</span></h2>
        <p class="muted" style="margin:0">Global Overall leaders (classic league 1) · GW${eh(real)} complete · next update after ${eh(g.next)}</p>
      </div>
      <div style="text-align:right"><span class="xb" style="--c:var(--green)">● LIVE · OFFICIAL FPL API</span>
        <div class="muted" style="margin-top:4px">no simulations · every row links a real public team</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px" class="x-dq">
      <div class="dq"><b>${m.n}</b><span>elite managers tracked</span></div>
      <div class="dq"><b>${m.proven}</b><span>verified past top-10k</span></div>
      <div class="dq"><b>${m.verified ? m.n : 0}</b><span>with multi-season history</span></div>
      <div class="dq"><b>GW1–${eh(real)}</b><span>real lineups analysed</span></div>
      <div class="dq"><b>${eh(g.open)}</b><span>open GW (data after deadline)</span></div>
      <div class="dq"><b>100%</b><span>of values from official API</span></div>
    </div>
    <p class="muted" style="margin:10px 0 0">This tab replaced the earlier simulated "X feed". Social posts would require a paid X API key that a static site can't hold — so this shows <b>real, verifiable behaviour instead</b>: who the current world leaders actually transferred in/out and captained each GW, read straight from their public FPL teams. Elite GW${eh(g.open)} moves appear after the ${eh(g.next)}.</p>
  </div>`;
}

// ---------- pulse ----------
function elitePulse() {
  const r = ET.rows(); const g = ET.gws();
  const byNet = (f) => r.slice().sort((a, b) => f(b) - f(a));
  const mostBought = byNet(x => x.bought)[0];
  const mostSold = byNet(x => x.sold)[0];
  const rising = byNet(x => x.delta)[0];
  const fall = byNet(x => -x.delta)[0];
  const caps = ET.captainGW(g.last);
  const lead = caps[0] ? ET.P(caps[0].id) : null;
  const leadShare = caps[0] ? caps[0].share : 0;
  const capNote = caps.length > 1 ? ` · ${ET.P(caps[1].id).name} ${caps[1].share}%` : '';
  const diffs = r.filter(x => x.cls === 'Rising elite differential').sort((a, b) => b.net - a.net)[0];
  const avoided = r.filter(x => x.cls.indexOf('Avoided') === 0).sort((a, b) => b.own_pub - a.own_pub)[0];
  const pl = (x) => x ? `<b>${eh(x.name)}</b> <span class="muted">${x.team} · ${x.pos} · ${x.share}% elite own</span>` : '—';
  const card = (ic, t, body, color) => `<div class="card x-pulse"><div class="xp-ic">${ic}</div>
    <div style="flex:1"><div class="xp-t" style="color:${color || 'var(--txt)'}">${t}</div>${body}</div></div>`;
  return `<div class="grid3">
    ${card('🔥', `Most bought for GW${g.last}`, mostBought ? pl(mostBought) + `<br><span class="muted">${mostBought.bought} of ${g.cohort} elite teams added him</span>` : '—', 'var(--green)')}
    ${card('🔻', `Most sold for GW${g.last}`, mostSold ? pl(mostSold) + `<br><span class="muted">${mostSold.sold} of ${g.cohort} dropped him</span>` : '—', 'var(--red)')}
    ${card('🎯', `Elite captaincy · GW${g.last}`, lead ? `<b>${eh(lead.name)}</b> <b style="color:var(--green)">${leadShare}%</b><br><span class="muted">of elite squads captained him${capNote}</span>` : '—')}
    ${card('📈', `Elite ownership rising`, rising && rising.delta > 0 ? pl(rising) + `<br><span class="muted">+${rising.delta} of ${g.cohort} elite teams since GW${+g.last - 1}</span>` : '—')}
    ${card('📉', `Elite ownership falling`, fall && fall.delta < 0 ? pl(fall) + `<br><span class="muted">${fall.delta} teams since GW${+g.last - 1}</span>` : '—')}
    ${card('💎', 'Elite differential', diffs ? pl(diffs) + `<br><span class="muted">low elite ownership but they're adding him</span>` : '—')}
    ${card('⚠️', 'Public favourite, elites avoid', avoided ? pl(avoided) + `<br><span class="muted">${avoided.own_pub}% public · only ${avoided.share}% elite own</span>` : '—', 'var(--amber)')}
    ${card('🧭', 'Minority captain', caps[1] ? pl({ name: ET.P(caps[1].id).name, team: ET.P(caps[1].id).team, pos: ET.P(caps[1].id).pos, share: caps[1].share }) + `<br><span class="muted">${caps[1].n} elite teams chose him</span>` : '—')}
    ${eliteSkillLens()}
  </div>`;
}

// ---------- ⭐ proven-elite lens (skill-weighted, real past-season ranks) ----------
function eliteSkillLens() {
  const sk = ET.skill(); const g = ET.gws();
  if (!sk.length) return '';
  const nProven = sk.filter(s => s.nTop10k).length;
  const n1k = sk.filter(s => s.nTop1k).length;
  const wsum = Math.round(sk.reduce((a, s) => a + s.w, 0) * 10) / 10;
  const pName = id => { const p = ET.P(id); return p ? p.name : '#' + id; };
  const ch = ET.churnSkill(String(g.last));
  const wb = ch.bought[0], ws = ch.sold[0];
  const cap = ET.capSkill(String(g.last))[0];
  const block = (ic, t, body) => `<div style="background:rgba(255,209,102,.07);border:1px solid rgba(255,209,102,.25);border-radius:10px;padding:8px 10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>${t}</b><span>${ic}</span></div><div style="margin-top:4px">${body}</div></div>`;
  return `<div class="card x-card" style="grid-column:1/-1">
    <h2 style="margin-bottom:2px">⭐ Proven-elite lens <span class="muted">— skill-weighted, from real past-season ranks</span></h2>
    <p class="muted" style="margin:0 0 8px">${sk.length} tracked leaders, but only <b>${nProven}</b> hold a real past top-10k finish (${n1k} top-1k). Weights: top-1k ×2 · top-10k ×1.5 · top-100k ×1.2 · newcomer ×0.6 → effective cohort <b>${wsum}</b>. The proven few steer these numbers more than a lucky first-season leader.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px">
      ${wb ? block('🔥', 'Weighted most bought · GW' + g.last, `<b>${eh(pName(wb.id))}</b> <span class="muted">raw ${wb.n} → w ${wb.wN}</span>`) : ''}
      ${ws ? block('🔻', 'Weighted most sold · GW' + g.last, `<b>${eh(pName(ws.id))}</b> <span class="muted">raw ${ws.n} → w ${ws.wN}</span>`) : ''}
      ${cap ? block('👑', 'Weighted captain · GW' + g.last, `<b>${eh(pName(cap.id))}</b> <span class="muted">${cap.share}% raw → ${cap.wShare}% weighted</span>`) : ''}
    </div>
    <p class="muted" style="margin:8px 0 0">Ask the Copilot "what do the proven elites do?" for the full weighted view. Weights are a labelled model from real history — a signal to weigh, not a commandment.</p>
  </div>`;
}

// ---------- trends table ----------
function eliteTrends() {
  const r = ET.rows(); const g = ET.gws();
  const rows = r.filter(x => Math.abs(x.net) >= 2 || x.cap >= 3 || x.delta <= -3)
    .slice(0, 40)
    .map(x => {
      const up = x.net > 0, down = x.net < 0;
      const shareCol = up ? 'var(--green)' : down ? 'var(--red)' : 'var(--muted)';
      return `<tr><td><b>${eh(x.name)}</b> <span class="team-tag">${x.team}</span><br>${eCls(x.cls)}</td>
        <td class="num">${x.own_elite_prev}</td><td class="num">${x.own_elite}</td>
        <td class="num"><b style="color:${up ? 'var(--green)' : down ? 'var(--red)' : 'var(--txt)'}">${up ? '+' + x.bought : down ? x.bought : 0}</b></td>
        <td class="num"><b style="color:${down ? 'var(--red)' : 'var(--txt)'}">${down ? x.sold : 0}</b></td>
        <td class="num"><b style="color:${shareCol}">${x.net > 0 ? '+' + x.net : x.net}</b></td>
        <td class="num">${x.cap ? x.cap + '/' + g.cohort : '–'}</td>
        <td style="min-width:120px">${eBar(x.share, x.net > 0 ? 'var(--green)' : x.net < 0 ? 'var(--red)' : '#8fa3c9')}</td>
        <td class="muted" style="white-space:normal;max-width:260px">${eh(ET.dataNote(x))}</td></tr>`;
    }).join('');
  return `<div class="card" style="overflow-x:auto"><h2>Real elite movement — GW${g.last} <span class="muted">(squad diff vs GW${+g.last - 1}; cohort = ${g.cohort} world leaders)</span></h2>
    <table class="data compact"><tr><th>Player</th><th class="num">Elite own<br>prev</th><th class="num">Elite own<br>now</th><th class="num">+Bought</th><th class="num">−Sold</th><th class="num">Net</th><th class="num">Captained</th><th>Elite own share</th><th>Data context</th></tr>${rows}</table>
    <p class="muted" style="margin:8px 0 0">"Data context" is neutral, computed from FPL numbers (fixtures × model × minutes) — <b>not</b> claimed reasons from social posts.</p></div>`;
}

// ---------- captaincy ----------
function eliteCap() {
  const g = ET.gws();
  const gwsList = [];
  for (let gw = 1; gw <= +g.last; gw++) {
    const caps = ET.captainGW(String(gw));
    gwsList.push({ gw, caps });
  }
  const block = gwsList.map(({ gw, caps }) => {
    const rows = caps.slice(0, 4).map(c => {
      const p = ET.P(c.id);
      return `<div class="cap-row"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${p ? eh(p.name) : '#' + c.id}</b> <span class="muted">${p ? p.team : ''}</span> <b style="color:var(--green)">${c.share}%</b> <span class="muted">${c.n}/${g.cohort} teams</span></div>${eBar(c.share, 'var(--green)')}</div>`;
    }).join('');
    return `<div class="card"><h3 style="margin:0 0 8px;color:var(--green)">GW${gw}</h3>${rows || '<p class="muted">—</p>'}</div>`;
  }).join('');
  return `<div class="card"><h2>Real elite captaincy by gameweek</h2>
    <p class="hint">Who the world leaders actually handed the armband to in each finished GW. GW${eh(g.open)} captain picks are locked at the deadline and appear here after ${eh(g.next)}.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">${block}</div></div>`;
}

// ---------- template ----------
function eliteTemplate() {
  const g = ET.gws(); const tp = ET.templateGW(g.last);
  const grp = (label, arr) => arr.length ? `<div class="card" style="grid-column:1/-1"><h3 style="margin:0 0 8px">${label}</h3>
      <div class="v-row">${arr.map(x => `<span><b>${eh(x.name)}</b> <span class="team-tag">${x.team} · ${x.share}%</span>${x.cls === 'rising' ? ' <span class="xb" style="--c:var(--amber)">rising</span>' : ''}</span>`).join('')}</div></div>` : '';
  return `<div class="card"><h2>Real elite squad template — GW${g.last} <span class="muted">(from ${g.cohort} actual lineups)</span></h2>
    <div style="display:grid;gap:10px">${grp('Goalkeepers', tp.GK)}${grp('Defenders', tp.DEF)}${grp('Midfielders', tp.MID)}${grp('Forwards', tp.FWD)}</div>
    <p class="muted" style="margin:8px 0 0">% = share of the ${g.cohort} real elite squads containing that player. "Rising" = below-template ownership but ≥6 elite teams added them for GW${g.last}.</p></div>`;
}

// ---------- player deep cards with 'should I care?' ----------
function elitePlayers() {
  const r = ET.rows(); const g = ET.gws();
  const ctx = (typeof window !== 'undefined' && window.TEAMCTX) || null;
  const ownedNames = new Set(ctx && ctx.squad ? ctx.squad.map(s => s.e && FOLDN(s.e.n)).filter(Boolean) : []);
  const mine = n => ownedNames.has(FOLDN(n));
  const cards = r.filter(x => Math.abs(x.net) >= 3 || x.cap >= 2).slice(0, 14).map(x => {
    const rec = eliteVerdict(x, mine(x.name));
    return `<div class="card x-plc">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div><div style="display:flex;gap:8px;align-items:center"><b style="font-size:15px">${eh(x.name)}</b> ${ePos(x.pos)}<span class="team-tag">${x.team} · £${x.cost}m</span>${mine(x.name) ? '<span class="xb" style="--c:var(--green)">YOU OWN</span>' : ''}</div>
          <div style="margin:6px 0 2px">${eCls(x.cls)}</div>
          <div class="muted" style="font-size:12px;max-width:520px">Elite own: <b>${x.own_elite_prev} → ${x.own_elite}</b> (${x.share}%) · GW${g.last}: <b style="color:var(--green)">+${x.bought}</b> / <b style="color:var(--red)">−${x.sold}</b>${x.cap ? ' · captained by ' + x.cap + '/' + g.cohort : ''}</div>
        </div>
        <div style="text-align:right;min-width:120px">
          <div class="muted" style="font-size:11px">GW model</div><div class="x-big" style="color:var(--green)">${(x.ep || 0).toFixed(1)}</div>
          <div class="muted" style="font-size:11px">public own</div><div class="x-big" style="font-size:16px">${x.own_pub}%</div>
        </div>
      </div>
      ${rec}
      <div class="muted" style="margin-top:6px">📊 ${eh(ET.dataNote(x))}</div>
    </div>`;
  }).join('');
  return `<div class="grid2" style="grid-template-columns:1fr"><h2>Where the world's leaders are moving — should you care?</h2>${cards}</div>`;
}
function FOLDN(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function eliteVerdict(x, mine) {
  if (mine && x.net <= -3) return `<span class="x-verdict red">You own him; elites dropped him (${x.sold} of them). ${x.share < 20 ? 'Elite ownership is now only ' + x.share + '%.' : ''} Check the data context — the exit may be fixture/price driven (model ${(x.ep || 0).toFixed(1)}) rather than form.</span>`;
  if (!mine && x.net >= 5) return `<span class="x-verdict green">${x.bought} elite teams added him for GW${ET.gws().last} and you don't own him — real elite demand. Not an auto-buy: compare him in ⚖️ Compare first, and note model ${(x.ep || 0).toFixed(1)} × fixtures above.</span>`;
  if (mine && x.net >= 3) return `<span class="x-verdict green">Elites are buying the same player you own (${x.bought} added) — your hold matches the leaders.</span>`;
  if (x.cap >= 5) return `<span class="x-verdict amber">🎯 Captained by ${x.cap}/${ET.gws().cohort} elite teams last GW${mine ? ' (including potentially you)' : ''} — a real captaincy signal, re-checked against your own captain options before you copy.</span>`;
  if (x.delta <= -4 && x.share < 25) return `<span class="x-verdict amber">Elite ownership shrank ${x.delta} teams this GW — a fading signal even at low ownership.</span>`;
  return '';
}

// ---------- verifiable move log ----------
function eliteMoves() {
  const g = ET.gws(); const tr = (D2().transfers || {})[g.last] || {};
  const by = tr.by || {}; const es = D2().elites || [];
  const nm = es2 => es2 ? (es2.entry_name || es2.player_name) : '?';
  const byEid = {}; es.forEach(e => byEid[e.entry] = e);
  const lines = [];
  Object.keys(by).forEach(eid => {
    (by[eid] || []).forEach(mv => {
      const a = ET.P(mv[0]), b = ET.P(mv[1]);
      lines.push({ eid: +eid, name: byEid[+eid] ? (byEid[+eid].entry_name + ' · ' + byEid[+eid].player_name) : '#' + eid,
        tin: a ? a.name : '#' + mv[0], tout: b ? b.name : '#' + mv[1] });
    });
  });
  lines.sort((x, y) => y.eid - x.eid);
  const rows = lines.slice(0, 20).map(l => `<div class="v-row"><span class="muted">entry ${l.eid}</span><b>${eh(l.name)}</b>
      <span style="color:var(--red)">out: ${eh(l.tout)}</span><span>→</span><span style="color:var(--green)">in: ${eh(l.tin)}</span>
      <a href="${eLink(l.eid)}" target="_blank" rel="noopener" style="margin-left:auto">open team ↗</a></div>`).join('');
  return `<div class="card"><h2>Verifiable evidence — real transfers by named elite teams (GW${g.last})</h2>
    <p class="hint">Sample of actual transfer-log entries for the tracked leaders. Every row links the public team on the official site — you can click through and confirm.</p>
    <div style="max-height:340px;overflow-y:auto">${rows || '<p class="muted">No transfer-log rows for this GW.</p>'}</div></div>`;
}

// ---------- my team ----------
function eliteTeam() {
  const ctx = (typeof window !== 'undefined' && window.TEAMCTX) || null;
  const r = ET.rows(); const g = ET.gws();
  const byName = {}; r.forEach(x => byName[FOLDN(x.name)] = x);
  if (!ctx || !ctx.squad || !ctx.squad.length) return `<div class="card"><h2>My Team × Elite Trends</h2><p class="hint">Load your team in the My Team tab to compare your squad against what the world leaders actually own.</p></div>`;
  const owned = ctx.squad.map(s => s.e && s.e.n).filter(Boolean);
  const rows = owned.map(nm => {
    const x = byName[FOLDN(nm)]; if (!x) return '';
    let advice;
    if (x.net <= -3) advice = `<span class="muted">Elites sold <b style="color:var(--red)">${eh(x.name)}</b> (−${x.sold}) — elite ownership ${x.share}%. ${x.ep < 5 ? 'Model is low too.' : 'Model still rates him ' + x.ep.toFixed(1) + ' — decide on your structure, not the crowd.'}</span>`;
    else if (x.net >= 3) advice = `<span class="muted">Elites are buying what you own (+${x.bought}) — aligned with the leaders.</span>`;
    else advice = `<span class="muted">No elite move on ${eh(x.name)} (elite own ${x.share}%).</span>`;
    return `<div class="v-row"><b>${eh(x.name)}</b><span class="team-tag">${x.pos}</span><div style="flex:1">${advice}</div><span style="color:${x.net > 0 ? 'var(--green)' : x.net < 0 ? 'var(--red)' : 'var(--muted)'}">${x.net > 0 ? '+' + x.net : x.net}</span></div>`;
  }).join('');
  const missing = r.filter(x => x.net >= 5 && !owned.some(o => FOLDN(o) === FOLDN(x.name)))
    .slice(0, 5).map(x => `<div class="v-row"><b>${eh(x.name)}</b> <span class="team-tag">${x.team} · ${x.pos}</span><span class="muted" style="margin-left:auto">+${x.bought} elite teams added</span></div>`).join('');
  return `<div class="card"><h2>My Team × what elites own</h2>${rows}</div>
    ${missing ? `<div class="card" style="margin-top:12px"><h2>Top elite buys you don't own</h2>${missing}<p class="muted" style="margin-top:6px">Check each in ⚖️ Compare against a player you'd drop — elite demand alone is not a reason to buy.</p></div>` : ''}`;
}

// ---------- report ----------
function eliteReport() {
  const r = ET.rows(); const g = ET.gws(); const caps = ET.captainGW(g.last);
  const lead = caps[0] ? ET.P(caps[0].id) : null;
  const mostIn = r.slice().sort((a, b) => b.net - a.net)[0];
  const mostOut = r.slice().sort((a, b) => a.net - b.net)[0];
  const diff = r.filter(x => x.cls === 'Rising elite differential').sort((a, b) => b.net - a.net)[0];
  const avoided = r.filter(x => x.cls.indexOf('Avoided') === 0).sort((a, b) => b.own_pub - a.own_pub)[0];
  const tp = ET.templateGW(g.last);
  const lineup = ['GK', 'DEF', 'MID', 'FWD'].map(p => tp[p].length ? `<b>${p}:</b> ${tp[p].slice(0, 4).map(x => x.name).join(', ')}` : '').join('<br>');
  const items = [
    ['🔥 Biggest elite buy (GW' + g.last + ')', mostIn ? `<b>${eh(mostIn.name)}</b> +${mostIn.bought} / −${mostIn.sold} · elite own now ${mostIn.share}%` : '—'],
    ['🔻 Biggest elite sell (GW' + g.last + ')', mostOut ? `<b>${eh(mostOut.name)}</b> −${mostOut.sold} · elite own fell ${mostOut.own_elite_prev} → ${mostOut.own_elite}` : '—'],
    ['🎯 Elite captaincy (GW' + g.last + ')', lead ? `<b>${eh(lead.name)}</b> ${caps[0].share}%${caps[1] ? ' · runner-up ' + eh(ET.P(caps[1].id).name) + ' ' + caps[1].share + '%' : ''}` : '—'],
    ['💎 Elite differential', diff ? `<b>${eh(diff.name)}</b> (${diff.share}% elite own, ${diff.bought} added)` : '—'],
    ['⚠️ Public favourite elites avoid', avoided ? `<b>${eh(avoided.name)}</b> (${avoided.own_pub}% public vs ${avoided.share}% elite)` : '—'],
    ['📊 Elite squad template (real, GW' + g.last + ')', lineup || '—'],
    ['⏭ Next', `Elite GW${eh(g.open)} moves (transfers + captain) appear here after the ${eh(g.next)} — official picks are sealed until then.`],
  ];
  const lis = items.map(([t, v], i) => `<li><b>${i + 1}. ${t}:</b> ${v}</li>`).join('');
  return `<div class="card"><h2>📋 GW${eh(g.last)} elite evidence report <span class="muted">— read from official FPL data</span></h2><ol class="rep">${lis}</ol>
    <p class="muted" style="margin-top:8px">Nothing on this tab is invented or quoted from social posts — each figure is aggregated from the real lineups and transfer logs of the tracked leaders, and every team can be opened and checked on the official site.</p></div>`;
}

// ---------- NL ----------
function eliteAsk(q0) {
  const q = String(q0 || '').toLowerCase();
  const r = ET.rows(); const g = ET.gws();
  const buy = r.slice().filter(x => x.net > 0).sort((a, b) => b.net - a.net);
  const sell = r.slice().filter(x => x.net < 0).sort((a, b) => a.net - b.net);
  const insuf = () => `Elite data only covers finished GWs (GW1–${g.last}). GW${g.open} behaviour will appear after ${g.next}.`;
  const ln = x => `<span class="mrow">• <b>${eh(x.name)}</b> <span class="muted">${x.team} · ${x.pos}</span> — ${x.net > 0 ? '+' + x.bought : '−' + x.sold} (net ${x.net > 0 ? '+' + x.net : x.net}) · elite own ${x.share}%${x.cap ? ' · captained ' + x.cap + '/' + g.cohort : ''}</span>`;
  
  // ⭐ proven-elite (skill-weighted) view — real past-season ranks
  if (/(weighted|skill.?weight|proven|experienced|seasoned|track.?record|top-?1k|top-?10k)/.test(q)) {
    const sk = ET.skill();
    const p10k = sk.filter(x => x.nTop10k).length, p1k = sk.filter(x => x.nTop1k).length;
    const wsum = Math.round(sk.reduce((a, x) => a + x.w, 0) * 10) / 10;
    const ch = ET.churnSkill(String(g.last));
    const wb = ch.bought[0], ws = ch.sold[0];
    const cap = ET.capSkill(String(g.last))[0];
    const pN = id => { const p = ET.P(id); return p ? p.name : '#' + id; };
    let out = `⭐ Skill-weighted elite view · GW${g.last}: ${p10k} of ${sk.length} have a real past top-10k finish (${p1k} top-1k) → effective cohort <b>${wsum}</b> in weighted terms.<br>`;
    if (cap) out += `<span class="mrow">👑 Weighted captain: <b>${eh(pN(cap.id))}</b> ${cap.share}% raw → <b>${cap.wShare}%</b> weighted</span>`;
    if (wb) out += `<br><span class="mrow">🔥 Weighted most bought: <b>${eh(pN(wb.id))}</b> (${wb.n} raw → w ${wb.wN})</span>`;
    if (ws) out += `<br><span class="mrow">🔻 Weighted most sold: <b>${eh(pN(ws.id))}</b> (${ws.n} raw → w ${ws.wN})</span>`;
    out += '<br><span class="muted">Weights: top-1k ×2 · top-10k ×1.5 · top-100k ×1.2 · newcomer ×0.6 (from real past-season ranks). Labelled model — a signal to weigh, not a rule.</span>';
    return out;
  }
  if (/buy|transfer.*in|bring.*in/.test(q) && !/sell/.test(q)) return buy.length ? `What elite leaders bought for GW${g.last} (real):<br>${buy.slice(0, 6).map(ln).join('')}` : insuf();
  if (/sell|drop|out|moving/.test(q)) return sell.length ? `What elite leaders sold for GW${g.last} (real):<br>${sell.slice(0, 6).map(ln).join('')}` : insuf();
  if (/captain|armband/.test(q)) {
    const caps = ET.captainGW(g.last);
    return caps.length ? `Elite captaincy GW${g.last} (real armbands):<br>${caps.slice(0, 3).map(c => `<span class="mrow">• <b>${eh(ET.P(c.id).name)}</b> ${c.share}% (${c.n}/${g.cohort})</span>`).join('')}<br><span class="muted">GW${g.open} armbands are locked until ${g.next}.</span>` : insuf();
  }
  if (/differential|emerging|under.?own/.test(q)) {
    const d = r.filter(x => x.cls === 'Rising elite differential').sort((a, b) => b.net - a.net);
    return d.length ? `Players elites are quietly adding (still low elite ownership):<br>${d.slice(0, 5).map(ln).join('')}` : insuf();
  }
  if (/template|my team/.test(q)) {
    const tp = ET.templateGW(g.last);
    const ctx = (typeof window !== 'undefined' && window.TEAMCTX) || null;
    let out = `Real elite template GW${g.last} (share of ${g.cohort} lineups):<br>`;
    ['GK', 'DEF', 'MID', 'FWD'].forEach(p => { if (tp[p].length) out += `<span class="mrow">• ${p}: ${tp[p].map(x => x.name + ' (' + x.share + '%)').join(', ')}</span>`; });
    if (ctx && ctx.squad) {
      const names = ctx.squad.map(s => s.e && s.e.n).filter(Boolean);
      const have = tp.DEF.concat(tp.MID, tp.FWD).filter(x => names.some(n => FOLDN(n) === FOLDN(x.name)));
      out += `<br><br>You own ${have.length} of the template core.${have.length >= 6 ? ' Strongly aligned.' : ''}`;
    }
    return out;
  }
  if (/why|reason/.test(q) && /sell|buy|out|drop/.test(q)) {
    return `I won't invent a "why" — I have real transfer records, not elite explanations. Here is neutral data context on the big movers:<br>${r.filter(x => Math.abs(x.net) >= 4).slice(0, 4).map(x => `<span class="mrow">• <b>${eh(x.name)}</b> (${x.net > 0 ? '+' + x.net : x.net} net): ${eh(ET.dataNote(x))}</span>`).join('')}<br><span class="muted">Elite explanations would need their posts/analysis — not available without a paid X API.</span>`;
  }
  if (/risk|worr|deadline/.test(q)) {
    const d = r.filter(x => x.delta <= -4).sort((a, b) => a.delta - b.delta);
    const avoid = r.filter(x => x.cls.indexOf('Avoided') === 0).sort((a, b) => b.own_pub - a.own_pub)[0];
    const bits = [];
    if (d.length) bits.push(`elite ownership shrinking fastest: ${d.slice(0, 3).map(x => eh(x.name)).join(', ')}`);
    if (avoid) bits.push(`public-vs-elite gap: ${eh(avoid.name)}`);
    return bits.length ? `Real signals to weigh before ${g.next}:<br>${bits.map(b => `<span class="mrow">• ${b}</span>`).join('')}<br><span class="muted">Elite GW${g.open} data lands after the deadline — until then these GW${g.last} facts are the freshest real evidence.</span>` : insuf();
  }
  if (/proven|who are|rank|history/.test(q)) {
    // ET.data() is the full dataset; the tracked managers live at .elite.elites.
    const dd = ET.data() || {};
    const list = (dd.elite && !Array.isArray(dd.elite) ? dd.elite.elites : null) || dd.elites || (Array.isArray(dd.elite) ? dd.elite : []) || [];
    const proven = list.filter(e => e.proven_top10k);
    return `Tracked cohort: world's current top ${list.length} (overall). ${proven.length} have a verified past top-10k finish (e.g. ${proven.slice(0, 3).map(e => e.player_name + ' · best ' + (e.best_rank || '?')).join('; ') || '—'}). Every team is public — open any of them on the official site.`;
  }
  if (/top 5|signals/.test(q)) {
    const o = [];
    const mi = buy[0], mo = sell[0]; const caps = ET.captainGW(g.last);
    if (mi) o.push(`Elite buy: ${eh(mi.name)} +${mi.bought}`);
    if (mo) o.push(`Elite sell: ${eh(mo.name)} −${mo.sold}`);
    if (caps[0]) o.push(`Elite captain GW${g.last}: ${eh(ET.P(caps[0].id).name)} ${caps[0].share}%`);
    const d = r.find(x => x.cls === 'Rising elite differential');
    if (d) o.push(`Differential: ${eh(d.name)}`);
    return o.length ? `Top real elite signals from GW${g.last}:<br>${o.map((x, i) => `<span class="mrow">${i + 1}. ${x}</span>`).join('')}<br><span class="muted">GW${g.open} updates after ${g.next}.</span>` : insuf();
  }
  return null;
}

function D2() { return (typeof DATA !== 'undefined' && DATA.elite) ? DATA.elite : { elites: [], gw: {}, transfers: {} }; }

// ---------- tab ----------
function renderElite() {
  const safe = (fn, id) => { try { fn(); } catch (e) { console.error('[ELITE]', id, e); const el = $(id); if (el) el.innerHTML = '<div class="card"><p class="hint">⚠️ ' + eh(e.message || e) + '</p></div>'; } };
  safe(() => { $('#xintDq').innerHTML = eliteDq(); }, '#xintDq');
  safe(() => { $('#xintPulse').innerHTML = elitePulse(); }, '#xintPulse');
  safe(() => { $('#xintTrends').innerHTML = eliteTrends(); }, '#xintTrends');
  safe(() => { $('#xintPlayers').innerHTML = elitePlayers(); }, '#xintPlayers');
  safe(() => { $('#xintCap').innerHTML = eliteCap(); }, '#xintCap');
  safe(() => { $('#xintTeam').innerHTML = eliteTeam(); }, '#xintTeam');
  safe(() => { $('#xintReport').innerHTML = eliteReport(); }, '#xintReport');
  const vo = $('#xintVoices'); if (vo) vo.innerHTML = eliteMoves();
}

// tabs
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'wildcard') renderWildcard();
  if (t.dataset.tab === 'xint') renderElite();
  if (t.dataset.tab === 'planner') renderBacktest();
});
$('#search').oninput = renderPlayers;
$('#min90').onchange = renderPlayers;
$('#loadTeam').onclick = loadMyTeam;
$('#teamId').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMyTeam(); });
// proxy URL (saved in browser localStorage)
const savedProxy = localStorage.getItem('fplProxy') || '';
if (savedProxy) $('#proxyUrl').value = savedProxy;
$('#saveProxy').onclick = () => {
  const v = $('#proxyUrl').value.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//.test(v)) { $('#proxyStatus').textContent = 'URL must start with https://'; return; }
  if (v) localStorage.setItem('fplProxy', v); else localStorage.removeItem('fplProxy');
  $('#proxyStatus').textContent = v ? 'Saved ✓ — now try Load My Team' : 'Cleared';
};
$$('#posChips .chip').forEach(c => c.onclick = () => {
  $$('#posChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  filterPos = c.dataset.pos;
  renderPlayers();
});

load();


// Elite desk (natural language)
function eliteAnswer(q) {
  const out = $('#xintOut');
  try {
    const ans = (typeof eliteAsk === 'function' && DATA.elite && (DATA.elite.elites || []).length) ? eliteAsk(q) : null;
    if (ans) { out.innerHTML = ans; out.classList.add('show'); }
    else { out.innerHTML = 'That needs the ⚖️ Compare / My Team tools or a player name. I answer from real elite data: buying/selling, captaincy, differentials, the template, my team vs elites, risks and top signals.'; out.classList.add('show'); }
  } catch (e) { out.innerHTML = '⚠️ ' + esc(e.message || e); out.classList.add('show'); }
}
(function wireElite() {
  const q = $('#xintQ'), btn = $('#xintAsk');
  if (!q || !btn) return;
  const ask = () => { const v = q.value.trim(); if (v) { eliteAnswer(v); q.value = ''; } };
  btn.onclick = ask;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  document.querySelectorAll('#xintQs .chip').forEach(c => { c.onclick = () => eliteAnswer(c.textContent); });
})();
