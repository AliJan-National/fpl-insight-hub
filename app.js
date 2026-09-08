const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DATA = {};

async function load() {
  const names = ['meta', 'league', 'results', 'players', 'radar', 'fixtures', 'news', 'captains', 'prices', 'fplmeta', 'ticker', 'teams', 'history', 'elite'];
  const res = await Promise.all(names.map(n => fetch(`api/${n}.json`).then(r => r.json())));
  names.forEach((n, i) => DATA[n] = res[i]);
  renderAll();
  try { ET.init(DATA); } catch (e) { console.error('[ELITE init]', e); }
}

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
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
  safe(renderRadar, 'radar'); safe(renderPlayers, 'players'); safe(renderFixtures, 'fixtures'); safe(renderNews, 'news');
  $('#playerNames').innerHTML = DATA.players.map(p => `<option value="${esc(p.name)}">`).join('');
  $('#cmpGo').onclick = () => { try { renderCompare(); } catch (e) { console.error('[compare]', e); $('#cmpOut').innerHTML = '<p class="hint">⚠️ Compare failed: ' + esc(e.message) + '</p>'; } };
  $('#planSolve').onclick = () => { try { solvePlan(); } catch (e) { console.error('[solvePlan]', e); $('#planOut').innerHTML = '<div class="card"><p class="hint">⚠️ Solver error: <b>' + esc(e.message) + '</b>. Reload My Team and try again.</p></div>'; } };
  $('#wcHorizon').onchange = () => { WC_H = +$('#wcHorizon').value || 3; WC = null; renderWildcard(); };
  safe(renderCaptains, 'captains'); safe(renderPrices, 'prices');
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
    return { r, e, t, fxs, pos: e ? e.et : 2, ep: e ? (e.ep || 0) : 0,
      a3: avg(fxs, 3), a5: avg(fxs, 5), flagged: !!(e && e.s && e.s !== 'a') };
  }).sort((a, b) => a.r.position - b.r.position);
  const ownedIds = new Set(squad.map(s => s.r.element));
  const capScore = s => s.ep * (fdrMult[(s.fxs[0] || {}).afdr || (s.fxs[0] || {}).fdr || 3] || 1) * (((s.fxs[0] || {}).ha) === 'H' ? 1.03 : 0.97) * (0.9 + 0.1 * ownForm(s));

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

  squad.forEach(s => {
    s.cap = capScore(s);
    const v = [];
    if (s.flagged) v.push(['⚠ FLAG', 'vd-sell']);
    v.push(xiSet.has(s.r.element) ? ['START', 'vd-start'] : ['BENCH', 'vd-bench']);
    if (capTop3.has(s.r.element) && !s.flagged) v.push(['C OPT', 'vd-cap']);
    if ((!xiSet.has(s.r.element) && s.ep < 1.6) || s.a3 >= 3.4 || s.flagged) v.push(['SELL?', 'vd-sell']);
    s.verdicts = v;
  });

  // ---- XI summary (11 cells; bench holds the remaining 4) ----
  const xiCells = xi.map(s => `<div class="xi-cell ${capPick && s.r.element === capPick.r.element ? 'capt' : ''}">
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
      <span class="team-tag" title="projected next GW">ep ${s.ep.toFixed(1)}</span>
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
    if (s.ep >= 7) reasons.push(`High ep (${s.ep.toFixed(1)})`);
    return `
    <div class="sig-card">
      <div class="rank">${i + 1}</div>
      <div class="sig-info">
        <div class="sig-name">${esc(s.e.n)} ${posBadge(posName[s.pos])}
          <span class="team-tag">GW${f0.gw || firstGw}: ${f0.opp || '—'}(${f0.ha || '?'}) <span class="fdr f${f0.fdr || 3}">${f0.fdr || 3}</span></span></div>
        <div class="sig-reasons">${reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('') || `<span class="reason">form ${frm}</span>`}</div>
        ${ML.ready ? `<div class="sig-reasons">${ML.capLens(s)}</div>` : ''}
      </div>
      <div class="sig-pts"><div class="pts">${s.cap.toFixed(1)}</div><div class="sig-meta">cap score<br>form ${frm}</div></div>
    </div>`;
  }).join('') || '<p class="hint">—</p>';

  // ---- Suggested transfer pairs ----
  const bank = (eh.bank ?? 0) / 10;
  const pairs = [];
  for (const s of squad) {
    if (!s.verdicts.some(v => v[0] === 'SELL?') || !s.e) continue;
    const funds = bank + s.e.c / 10;
    const best = DATA.players
      .filter(p => !ownedIds.has(p.id) && p.status === 'a' && p.mins >= 90 && p.cost <= funds && p.pos === posName[s.pos] && adjAvg3(p) <= 2.9)
      .sort((a, b) => (b.ep_next + ownForm(b)) - (a.ep_next + ownForm(a)))
      .map(p => ({ p, sc: (p.ep_next || 0) + p.form * 0.5 }))
      .sort((a, b) => b.sc - a.sc)[0];
    if (best && best.p.ep_next - s.ep > 0.4) pairs.push({ out: s, in: best.p, delta: best.p.ep_next - s.ep, funds });
  }
  pairs.sort((a, b) => b.delta - a.delta);
  $('#pairsList').innerHTML = pairs.slice(0, 3).map(pr => `
    <div class="pair-card">
      <div class="who"><b class="down">${esc(pr.out.e.n)}</b> <span class="team-tag">${pr.out.t ? pr.out.t.short : ''} · £${(pr.out.e.c / 10).toFixed(1)}m · ep ${pr.out.ep.toFixed(1)}</span></div>
      <span class="arrow">→</span>
      <div class="who"><b class="up">${esc(pr.in.name)}</b> <span class="team-tag">${pr.in.team} · £${pr.in.cost}m · ep ${pr.in.ep_next}</span></div>
      <div class="delta"><span class="up">+${pr.delta.toFixed(1)}</span><div class="sig-meta">Δ/GW · funds £${pr.funds.toFixed(1)}m ✓</div></div>
    </div>`).join('') || '<p class="hint">No affordable, clearly positive moves right now — holding is fine.</p>';

  // ---- GW-by-GW game plan (hold / bench-sell / buy) ----
  const benchVals = bench.map(s => (s.e ? s.e.c / 10 : 0)).sort((a, b) => b - a);
  const maxFund = bank + (benchVals[0] || 0) + 0.05;
  const planHtml = [0, 1, 2].map(i => {
    const g = firstGw + i;
    const scored = squad.map(s => ({ s, f: s.fxs[i], sc: s.ep * (fdrMult[(s.fxs[i] || {}).afdr || (s.fxs[i] || {}).fdr || 3] || 1) * (0.9 + 0.1 * ownForm(s)) }))
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

// ============ Assistant (data-grounded copilot) ============
function scout(p) {
  const d = (p.xg_diff || 0);
  const PP = playerProb(p);
  return `<b>${esc(p.name)}</b> (${p.team}, ${p.pos}, £${p.cost}m, ${p.own}% owned)<br>
  <span class="mrow">📊 ${p.pts} pts · form ${p.form} · ep next ${p.ep_next} · ${p.g}G ${p.a}A in ${p.mins}'</span><br>
  <span class="mrow">🎯 xG ${p.xg} vs ${p.g} goals (${d >= 0 ? '+' : ''}${d.toFixed(1)} → ${d < -0.5 ? 'due a return' : d > 0.8 ? 'overperforming' : 'about right'})</span><br>
  <span class="mrow">📈 ${sparkSVG(p.id, 160, 34) || 'no match history yet'}</span><br>
  <span class="mrow">📅 ${(p.next3 || []).map(f => `${f.opp}(${f.ha})<span class="fdr f${f.afdr ?? f.fdr}" title="form-adjusted ${f.adjv ?? f.fdr} (base ${f.fdr})">${f.afdr ?? f.fdr}</span>`).join(' ')}</span><br>
  <span class="mrow">🏆 team form: #${formRank(p)} of 20 (${(window.TF[p.team] || {}).ppg ?? '–'} ppg, xG diff ${( (window.TF[p.team] || {}).xgd ?? 0) > 0 ? '+' : ''}${(window.TF[p.team] || {}).xgd ?? 0}/game — as ranked in the Fixtures ticker)</span><br>
  <span class="mrow">🎲 P(≥6) ${PP.p6}% · P(≥10) ${PP.p10}% <span class="muted">(chance ≠ prediction — real GW1-3 + pos base rate)</span> · swing ±${PP.sd.toFixed(1)}/GW</span><br>
  <span class="mrow">💷 price: ${p.price_dir === 'rise' ? '📈 rising' : p.price_dir === 'fall' ? '📉 falling' : '➖ stable'}</span>`;
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
      + ppRows(p)
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

function askAI(q) {
  const Q = q.toLowerCase();
  const ctx = window.TEAMCTX;
  try { if (typeof eliteAsk === 'function' && DATA.elite && (DATA.elite.elites || []).length) { const er = eliteAsk(q); if (er) return er; } } catch (e) { console.error('[ELITE ask]', e); }
  const _pair = resolvePair(q);
  if (_pair && !/^\s*(compare|open in compare)/i.test(Q)) return pairDecision(_pair[0], _pair[1], q);
  const pl = findPlayer(q);
  if (/captain|armband/.test(Q)) {
    if (ctx) {
      const ranked = ctx.squad.map(s => ({ s, c: s.cap })).sort((a, b) => b.c - a.c).slice(0, 3);
      return `For <b>GW${ctx.picksGw + 1}</b>, your captain options ranked by fixture-adjusted projection:<br>` +
        ranked.map((x, i) => `<span class="mrow">${i + 1}. <b>${esc(x.s.e.n)}</b> — ${((x.s.fxs[0] || {}).opp) || '—'}(${(x.s.fxs[0] || {}).ha || '?'}), adj FDR ${(x.s.fxs[0] || {}).afdr ?? (x.s.fxs[0] || {}).fdr ?? 3}, ep ${x.s.ep.toFixed(1)} → score ${x.c.toFixed(1)}</span>`).join('') +
        `<br><span class="mrow">Verdict: <b>${esc(ranked[0].s.e.n)}</b> is the standout${ranked[1] ? '; ' + esc(ranked[1].s.e.n) + ' the safe vice.' : '.'}</span>`;
    }
    return `Global captain picks this GW: <b>${DATA.captains.slice(0, 3).map(c => c.name).join(', ')}</b> — see the Captain & Prices tab for reasons.`;
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
    return `For GW${ctx.picksGw + 1}, your weakest projections (bench them):<br>` + b.map(s => `<span class="mrow">• <b>${esc(s.e.n)}</b> — ${((s.fxs[0] || {}).opp) || '—'}(${(s.fxs[0] || {}).ha || '?'} adj FDR ${(s.fxs[0] || {}).afdr ?? (s.fxs[0] || {}).fdr ?? 3}), ep ${s.ep.toFixed(1)}</span>`).join('') + `<br><span class="mrow">Bench waste if all sit: ${b.reduce((s, x) => s + x.ep, 0).toFixed(1)} pts.</span>`;
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
$('#chatLog').innerHTML = `<div class="msg bot">👋 I'm your <b>FPL Copilot</b>. I know the full 2026/27 dataset (653 players, fixtures, xG, prices) — and once you load your team in <b>My Team</b>, every answer becomes personal. Try the quick questions!</div>`;

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

  $('#mlCap').innerHTML = `<div class="card"><h2>👑 Captaincy — ML lens</h2>
    ${capCands.map((cc, i) => `<span class="mrow">${i + 1}. <b>${esc(cc.x.e.n)}</b> ep ${cc.x.ep.toFixed(1)} <span class="capclass cap-${cc.cls}">${cc.cls}</span> <span class="tk-opp">${cc.rivCap}/${n} rivals captain him</span></span><br>`).join('')}
    <p style="margin-top:6px">Engine pick for <b>${mode}</b> mode: <b>${esc(capPick.x.e.n)}</b> — ${capPick.cls === 'SAFE' ? 'matching the field protects your position.' : capPick.cls === 'BALANCED' ? 'solid points with a slight edge over some rivals.' : 'the upside edge your gap requires; rivals won\'t match it.'}</p>
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

// per-GW model projection: blend(official ep, form) × form-adjusted FDR × H/A × minutes × reliability
const projP = (p, i) => {
  const t = window.TF[p.team] || {};
  const a = (t.afx || [3, 3, 3, 3, 3, 3, 3])[i] ?? 3;
  const f = (p.next3 || [])[i] || null;
  const ha = f ? f.ha : null;
  const minProb = p.status !== 'a' ? 0.3 : Math.min(1, 0.5 + 0.5 * ((p.mins || 0) / 270));
  const base = 0.55 * (p.ep_next || 0) + 0.45 * (p.form || 0);
  return base * (FM[Math.max(1, Math.min(5, Math.round(a)))] || 1) * (ha === 'H' ? 1.06 : ha === 'A' ? 0.94 : 1) * minProb * (0.6 + 0.4 * reliab(p));
};
const hSumP = (p, H) => { let s = 0; for (let i = 0; i < H; i++) s += projP(p, i); return s; };
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
  const key = p.id + '|' + mins + '|' + status;
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
  const minProb = status !== 'a' ? 0.3 : Math.min(1, 0.5 + 0.5 * (mins / 270));
  const gate = 0.25 + 0.75 * minProb;
  p6 = Math.max(1, Math.min(85, Math.round(p6 * gate)));
  p10 = Math.max(1, Math.min(60, Math.round(p10 * gate)));
  const avg = n ? scores.reduce((a, x) => a + x, 0) / n : 0;
  let sd = n > 1 ? Math.sqrt(scores.reduce((s, x) => s + (x - avg) * (x - avg), 0) / (n - 1)) : 0;
  if (n < 2) sd = b.n ? Math.sqrt(Math.max(0, b.sq / b.n - (b.sum / b.n) * (b.sum / b.n))) : 3;
  sd = Math.max(1.5, Math.min(8, Math.round(sd * 10) / 10)); // typical per-GW swing
  const best = n ? Math.max.apply(null, scores) : 0;
  PP_MEMO[key] = { n, p6, p10, sd, best, obs6, obs10, prior6: Math.round(prior6), prior10: Math.round(prior10) };
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
function startersAt(squad, i) {
  return bestXI(squad, p => projP(p, i)) || squad.slice(0, 11);
}
const teamProjAt = (squad, i) => {
  const st = startersAt(squad, i);
  return st.reduce((s, p) => s + projP(p, i), 0) + Math.max(0, ...st.map(p => projP(p, i)));
};
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
    const H = +$('#planHorizon').value || 4;
    const byName = {}; DATA.players.forEach(p => { byName[p.name] = p; });
    let squad = ctx.squad.map(s => DATA.players.find(p => p.id === s.r.element) || (s.e && byName[s.e.n])).filter(Boolean);
    if (squad.length < 11) {
      out.innerHTML = `<div class="card"><p class="hint">⚠️ Only matched <b>${squad.length}/15</b> of your squad to the player database — your team has players newer than this data snapshot. Reload <b>My Team</b> and try again, or ask the Copilot for transfer advice meanwhile.</p></div>`;
      $('#chipOpt').innerHTML = '';
      return;
    }
    let bank = ctx.bank, ft = 1;
    const rows = [];
    const pool = DATA.players.filter(p => p.status === 'a' && p.mins >= 60);
    for (let i = 0; i < H; i++) {
      const rem = H - i;
      const base = teamProjAt(squad, i);
      let best = { val: 0.0, act: null };
      const outs = squad.slice().sort((a, b) => hSumP(a, rem) - hSumP(b, rem)).slice(0, 6);
      const ins = pool.filter(p => !squad.includes(p)).sort((a, b) => hSumP(b, rem) - hSumP(a, rem)).slice(0, 16);
      for (const out of outs) for (const inn of ins) {
        if (inn.cost > bank + out.cost + 0.1 || !shapeOK(squad, out, inn)) continue;
        const sq2 = squad.map(p => (p === out ? inn : p));
        let val = teamProjAt(sq2, i) - base;
        if (i + 1 < H) val += 0.6 * (teamProjAt(sq2, i + 1) - teamProjAt(squad, i + 1));
        if (ft <= 0) val -= 4;
        if (val > best.val + 0.25) best = { val, act: { out, inn } };
      }
      const hit = !!best.act && ft <= 0;
      if (best.act) { bank += best.act.out.cost - best.act.inn.cost; squad = squad.map(p => (p === best.act.out ? best.act.inn : p)); ft = Math.max(0, ft - 1); }
      else ft = Math.min(5, ft + 1);
      const st = startersAt(squad, i);
      const cap = st.slice().sort((a, b) => projP(b, i) - projP(a, i))[0];
      rows.push({ gw: DATA.fplmeta.current_gw + 1 + i, act: best.act, hit, cap, proj: teamProjAt(squad, i), ft });
    }
    const tot = rows.reduce((s, r) => s + r.proj, 0);
    out.innerHTML = `<div class="card"><h2>🧾 Optimal ${H}-GW plan · projected ≈ ${tot.toFixed(1)} pts</h2>
    <table class="data"><tr><th>GW</th><th>Move</th><th>Captain</th><th class="num">Proj XI+cap</th><th>FT left</th></tr>
    ${rows.map(r => `<tr><td><b>GW${r.gw}</b></td>
      <td>${r.act ? `<span class="down">− ${esc(r.act.out.name)}</span> → <span class="up">+ ${esc(r.act.inn.name)}</span>${r.hit ? ' <b class="down">(hit −4)</b>' : ''}</td>` : 'Roll (save FT)'}</td>
      <td><b>${r.cap ? esc(r.cap.name) : '—'}</b></td><td class="num">${r.proj.toFixed(1)}</td><td class="num">${r.ft}</td></tr>`).join('')}
    </table>
    <p class="muted">Projections use the shared form-adjusted model (ep × adj FDR × home/away × minutes × reliability). Re-solve after every deadline — plans are dynamic, not promises.</p></div>`;
    chipOptimizer(squad, H);
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
const eh = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
