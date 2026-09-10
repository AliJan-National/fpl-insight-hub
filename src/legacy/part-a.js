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

