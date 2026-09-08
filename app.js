const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DATA = {};

async function load() {
  const names = ['meta', 'league', 'results', 'players', 'radar', 'fixtures', 'news', 'captains', 'prices', 'fplmeta', 'ticker', 'teams', 'history', 'xint'];
  const res = await Promise.all(names.map(n => fetch(`api/${n}.json`).then(r => r.json())));
  names.forEach((n, i) => DATA[n] = res[i]);
  renderAll();
  try { XT.init(DATA); } catch (e) { console.error('[XINT init]', e); }
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

  // ---- Projected best XI (FPL bench rules: GK1 + DEF3 + MID3 + FWD2) ----
  const byPos = p => squad.filter(s => s.pos === p).sort((a, b) => b.ep - a.ep);
  const xi = [...byPos(1).slice(0, 1), ...byPos(2).slice(0, 3), ...byPos(3).slice(0, 3), ...byPos(4).slice(0, 2)];
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

  // ---- XI summary ----
  const xiCells = [...byPos(1).slice(0, 1), ...byPos(2).slice(0, 3), ...byPos(3).slice(0, 3), ...byPos(4).slice(0, 2)]
    .map(s => `<div class="xi-cell ${capPick && s.r.element === capPick.r.element ? 'capt' : ''}">
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
  return `<b>${esc(p.name)}</b> (${p.team}, ${p.pos}, £${p.cost}m, ${p.own}% owned)<br>
  <span class="mrow">📊 ${p.pts} pts · form ${p.form} · ep next ${p.ep_next} · ${p.g}G ${p.a}A in ${p.mins}'</span><br>
  <span class="mrow">🎯 xG ${p.xg} vs ${p.g} goals (${d >= 0 ? '+' : ''}${d.toFixed(1)} → ${d < -0.5 ? 'due a return' : d > 0.8 ? 'overperforming' : 'about right'})</span><br>
  <span class="mrow">📈 ${sparkSVG(p.id, 160, 34) || 'no match history yet'}</span><br>
  <span class="mrow">📅 ${(p.next3 || []).map(f => `${f.opp}(${f.ha})<span class="fdr f${f.afdr ?? f.fdr}" title="form-adjusted ${f.adjv ?? f.fdr} (base ${f.fdr})">${f.afdr ?? f.fdr}</span>`).join(' ')}</span><br>
  <span class="mrow">🏆 team form: #${formRank(p)} of 20 (${(window.TF[p.team] || {}).ppg ?? '–'} ppg, xG diff ${( (window.TF[p.team] || {}).xgd ?? 0) > 0 ? '+' : ''}${(window.TF[p.team] || {}).xgd ?? 0}/game — as ranked in the Fixtures ticker)</span><br>
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
function askAI(q) {
  const Q = q.toLowerCase();
  const ctx = window.TEAMCTX;
  try { if (typeof xAsk === 'function' && DATA.xint && (DATA.xint.posts || []).length) { const xr = xAsk(q); if (xr) return xr; } } catch (e) { console.error('[XINT ask]', e); }
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

async function mlFetchEntry(id) {
  const ck = id + '_' + mlGw();
  const c = mlCacheGet(ck);
  if (c) return c;
  const [picks, hist] = await Promise.all([
    fplApi(`entry/${id}/event/${mlGw()}/picks/`),
    fplApi(`entry/${id}/history/`),
  ]);
  const out = { picks, chips: (hist.chips || []).map(x => x.name) };
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
      R.push({ row: r, s: mlSquadStats(d.picks, EL, TM), chips: d.chips });
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
  // win probability (Monte Carlo, labelled estimate — spec §16)
  function randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function winProb(muAdj, sd) {
    const N = 1200; let w = 0;
    for (let i = 0; i < N; i++) {
      const uFin = you.total + (youS.mu + muAdj) * gwsLeft + randn() * sd * Math.sqrt(gwsLeft);
      let best = uFin;
      for (const rv of R) {
        const f = rv.row.total + rv.s.mu * gwsLeft + randn() * 10 * Math.sqrt(gwsLeft);
        if (f > best) best = f;
      }
      if (best === uFin) w++;
    }
    return Math.round(100 * w / N);
  }
  const probs = { Safe: winProb(-0.4, 8.5), Balanced: winProb(0.6, 10), Aggressive: winProb(1.6, 12.5) };
  const bestProb = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];

  Object.assign(ML, {
    ready: true, you, youS, R, leader, gap, catchRate, gwsLeft, mode, modeTxt, n,
    threats, diffs, capCands, capPick, tgt, gain, hitText, probs, prim,
    youChips, sorted,
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
    <p class="muted">Win-probability estimate (Monte-Carlo, indicative): Safe <b>${probs.Safe}%</b> · Balanced <b>${probs.Balanced}%</b> · Aggressive <b>${probs.Aggressive}%</b> → engine recommends <b>${bestProb[0]}</b>.</p>
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
function startersAt(squad, i) {
  const gks = squad.filter(p => p.pos === 'GK').sort((a, b) => projP(b, i) - projP(a, i));
  const out = gks.slice(0, 1);
  const need = { DEF: 3, MID: 3, FWD: 2 };
  for (const pos of ['DEF', 'MID', 'FWD']) {
    const arr = squad.filter(p => p.pos === pos).sort((a, b) => projP(b, i) - projP(a, i));
    out.push(...arr.slice(0, need[pos]));
  }
  return out;
}
const teamProjAt = (squad, i) => {
  const st = startersAt(squad, i);
  return st.reduce((s, p) => s + projP(p, i), 0) + Math.max(0, ...st.map(p => projP(p, i)));
};
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
    <p class="muted">${reliab(a) >= reliab(b) ? `${esc(a.name)}'s returns are also more reliable (${Math.round(reliab(a) * 100)}% vs ${Math.round(reliab(b) * 100)}%) — underlying xGI backs the output.` : `Note: ${esc(b.name)} is the more reliable pick (${Math.round(reliab(b) * 100)}% vs ${Math.round(reliab(a) * 100)}%) — ${esc(a.name)}'s edge leans on fixtures; weigh floor vs ceiling.`}${ML.ready ? ` Mini-league: ${ML.ownCount(a)}/${ML.n} rivals own ${esc(a.name)} vs ${ML.ownCount(b)}/${ML.n} for ${esc(b.name)}.` : ''}</p></div>`;
}


// ============ 🧠 X INTELLIGENCE MODULE ============
// ============================================================================
// 🧠 X INTELLIGENCE — Elite Manager Trends
// Architecture: X data collection → post classification → account credibility →
// entity extraction → action detection → independent-signal detection →
// trend & momentum → consensus/disagreement → reason extraction →
// historical accuracy → FPL data integration → personal team integration →
// final intelligence → dashboard.  (Feed schema: api/xint.json)
// ============================================================================
const XT = (() => {
  let ok = false, D = {};
  const T0 = 1, T2 = 2, T3 = 3, T4 = 4;
  const TW = { 1: 1.00, 2: 0.85, 3: 0.65, 4: 0.20, 5: 0.05 };
  const INTENT_W = { action: 1, lean: 0.55, weak: 0.2, neutral: 0 };
  const FOLD = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nowMs = () => Date.now();
  const hAgo = (iso) => Math.max(0, (nowMs() - new Date(iso).getTime()) / 36e5);

  // freshness windows (#21): news/injury decay faster than opinion
  const fresh = (iso, newsy) => {
    const h = hAgo(iso);
    const lim = newsy ? [3, 9, 24] : [6, 24, 48];
    if (h < lim[0]) return { k: 'fresh', t: 'Fresh', c: 'var(--green)' };
    if (h < lim[1]) return { k: 'aging', t: 'Aging', c: 'var(--amber)' };
    if (h < lim[2]) return { k: 'old', t: 'Old', c: '#ff9d5c' };
    return { k: 'stale', t: 'Stale', c: 'var(--red)' };
  };
  const ageTxt = (iso) => {
    const h = Math.round(hAgo(iso));
    if (h < 1) return '<1h'; if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd' + (h % 24 ? (h % 24) + 'h' : '');
  };

  const cache = { acc: {}, out: {}, mets: {}, agg: null, buzz: {}, snap: null, report: null };

  // ---------- helpers ----------
  function plr(name) {
    if (D.byName == null) {
      D.byName = {};
      (D.players || []).forEach(p => { const k = FOLD(p.name); if (!D.byName[k]) D.byName[k] = p; });
    }
    return D.byName[FOLD(name)] || null;
  }
  function acc(handle) {
    if (!cache.acc[handle]) {
      const a = (D.xint.accounts || []).find(x => x.handle === handle) || null;
      cache.acc[handle] = a;
    }
    return cache.acc[handle];
  }
  function histRows(name) {
    const p = plr(name);
    if (!p || !D.history) return [];
    return (D.history[p.id] || []).map(r => ({ gw: r[0], pts: r[1], mins: r[4], xg: r[2], xa: r[3] }));
  }
  // measured accuracy from stored past calls vs real history (#4)
  function measured(handle) {
    if (cache.mets[handle]) return cache.mets[handle];
    const calls = (D.xint.calls || []).filter(c => c.account === handle);
    const by = {}, out = { overall: null, byCat: {} };
    let hit = 0, tot = 0, maxGw = D.maxGw || 3;
    calls.forEach(c => {
      const rows = histRows(c.player);
      const r = rows.find(x => x.gw === c.gw + 1);
      if (!r && c.gw + 1 > maxGw) return; // outcome not played yet
      const pts = r ? r.pts : 0;
      const success = c.type === 'avoid' ? pts <= 2 : pts >= 5;
      by[c.type] = by[c.type] || { h: 0, t: 0 };
      by[c.type].t++; by[c.type].h += success ? 1 : 0;
      if (r) { tot++; hit += success ? 1 : 0; }
    });
    const cats = Object.keys(by).map(k => ({ cat: k, ...by[k], pct: by[k].t ? Math.round(100 * by[k].h / by[k].t) : null }));
    out.byCat = cats;
    out.hits = hit; out.total = tot;
    out.pct = tot >= 3 ? Math.round(100 * hit / tot) : null;
    cache.mets[handle] = out;
    return out;
  }
  // effective account weight = tier base × measured accuracy (else seed)
  function effW(handle) {
    const a = acc(handle);
    if (!a) return 0.02;
    const m = measured(handle);
    const accScore = m.pct != null ? Math.round(0.6 * m.pct + 0.4 * (a.seed_reliability || 55))
                                  : (a.seed_reliability || 55);
    const w = TW[a.tier] || 0.05;
    return Math.max(0.03, Math.min(1, w * (0.45 + 0.55 * accScore / 100)));
  }
  function accScore(handle) {
    const a = acc(handle);
    if (!a) return 55;
    const m = measured(handle);
    return m.pct != null ? Math.round(0.6 * m.pct + 0.4 * (a.seed_reliability || 55)) : (a.seed_reliability || 55);
  }

  // ---------- independent signals (#23/#24): echo clusters count ~once ----------
  const isIndependent = p => !p.origin || p.origin === 'self' || p.origin === p.id;

  // ---------- reason lexicon (#19) ----------
  const RULES = [
    [/penalt/i, 'pen', 'Penalty duty'],
    [/fixture|fdr|schedule|blank|double|run\b/i, 'fix', 'Fixtures'],
    [/\bhome\b|\(\w\)\b|at home/i, 'hom', 'Home advantage'],
    [/\baway\b|\(\a\)/i, 'awy', 'Away trip'],
    [/weak|concede|leaky|defen/i, 'wdf', 'Opponent defence'],
    [/xgi|\bxg\b|expected|underlying/i, 'xgi', 'Underlying xGI'],
    [/form|blanked|haul|outscor|points\b/i, 'frm', 'Recent form'],
    [/minute|started|rested|\bstart\b|bench/i, 'min', 'Minutes'],
    [/rotation|midweek|\bucl\b|european tie|rested|rest him/i, 'rot', 'Rotation risk'],
    [/presser|news|injur|training|fitness/i, 'new', 'Team news'],
    [/tactical|role|formation|\bline\b|position/i, 'tac', 'Tactical role'],
    [/price|\bcost\b|£|fund|sell|value/i, 'prc', 'Price / funding'],
    [/captain|armband|\bcap\b/i, 'cap', 'Captaincy'],
    [/own|ownership|template|bandwagon/i, 'own', 'Ownership'],
    [/differential|under-?own|low-?own/i, 'dif', 'Differential'],
    [/wildcard|\bwc\b/i, 'wc', 'Wildcard structure'],
    [/set-?piece|corner|dead.?ball|penalt/i, 'sp', 'Set pieces'],
  ];
  const REASON_LABEL = k => (RULES.find(r => r[1] === k) || [0, k, k])[2];
  function reasonsOf(p) {
    const m = {};
    RULES.forEach(([re, k]) => { if (re.test(p.text)) m[k] = true; });
    // negated claims ("no rotation", "no Europe drama") must NOT become reasons
    if (/(\bno\b|without|not a|unlikely|isn't a|is not a)[^.!?]{0,34}?\b(rotation|midweek|europe|minutes risk|rested|injur|doubt)/i.test(p.text)) {
      delete m.rot; delete m.min; delete m.new;
    }
    return Object.keys(m);
  }

  // ---------- aggregation (the trend engine) ----------
  function isPlayerCat(c) { return c !== 'chip' && c !== 'watchlist'; }
  function agg() {
    if (cache.agg) return cache.agg;
    const feed = D.xint; const res = { byPlayer: {}, posts: [], maxGw: D.maxGw || 3 };
    feed.posts.forEach(p => {
      const a = acc(p.author);
      const w = INTENT_W[p.intent] || 0;
      const ew = effW(p.author);
      res.posts.push(p);
      // voice row meta
      const row = { p, a, ew, indep: isIndependent(p), fresh: fresh(p.ts, /news|injur/i.test(p.category || '')) };
      if (isIndependent(p)) res.indep = (res.indep || 0) + 1;
      (p.players || []).forEach(nm => {
        const P = plr(nm);
        if (!P) return;
        const b = res.byPlayer[P.name] || (res.byPlayer[P.name] = { P, inW: 0, outW: 0, capW: 0, holdW: 0, avoidW: 0,
          confIn: [], confOut: [], confCap: [], confHold: [], confAvoid: [], consIn: [], consOut: [], consCap: [],
          authors: {}, posts: [], buzz: 0, age: 99, catCount: {} });
        if (!isIndependent(p) && p.intent === 'weak' && p.origin !== 'self') { /* echo: buzz only */ }
        b.buzz += Math.log10((p.engagement && p.engagement.likes) || 1) + 1;
        b.age = Math.min(b.age, hAgo(p.ts));
        b.posts.push(p);
        if (isIndependent(p) && w > 0 && p.category !== 'chip') b.authors[p.author] = true;
        if (w > 0 && isIndependent(p) && p.category !== 'chip') { // TC/FH chip posts are NOT weekly captaincy signals
          const ents = p.ents || [];
          if (ents.indexOf('in') >= 0) b.inW += w * ew;
          if (ents.indexOf('out') >= 0 || ents.indexOf('sell') >= 0) b.outW += w * ew;
          if (ents.indexOf('cap') >= 0) b.capW += w * ew;
          if (ents.indexOf('hold') >= 0) b.holdW += w * ew;
          if (ents.indexOf('avoid') >= 0) b.avoidW += w * ew;
        }
        // confirmed vs considering (#5/#8)
        if (p.intent === 'action' && isIndependent(p)) {
          (p.ents || []).forEach(e => {
            if (e === 'in' && b.confIn.indexOf(p.author) < 0) b.confIn.push(p.author);
            if (e === 'out' && b.confOut.indexOf(p.author) < 0) b.confOut.push(p.author);
            if (e === 'cap' && b.confCap.indexOf(p.author) < 0) b.confCap.push(p.author);
            if (e === 'hold' && b.confHold.indexOf(p.author) < 0) b.confHold.push(p.author);
            if (e === 'avoid' && b.confAvoid.indexOf(p.author) < 0) b.confAvoid.push(p.author);
          });
        }
        if ((p.intent === 'action' || p.intent === 'lean') && isIndependent(p)) {
          (p.ents || []).forEach(e => {
            if (e === 'in' && b.consIn.indexOf(p.author) < 0) b.consIn.push(p.author);
            if (e === 'out' && b.consOut.indexOf(p.author) < 0) b.consOut.push(p.author);
            if (e === 'cap' && b.consCap.indexOf(p.author) < 0) b.consCap.push(p.author);
          });
        }
      });
    });
    // per-player summary
    Object.values(res.byPlayer).forEach(b => {
      const P = b.P;
      const top = b.capW + b.holdW * 0.5 + b.inW;
      b.nAuth = Object.keys(b.authors).length;
      b.eliteAuth = Object.keys(b.authors).filter(h => { const a = acc(h); return a && a.tier <= 2; }).length;
      b.own = P.own || 0;
      b.evidence = evidence(P);
      b.hype = 0;
      const netD = b.inW - b.outW;
      b.dirs = netD > 0.12 ? 'in' : netD < -0.12 ? 'out'
        : (b.holdW >= 0.35 ? 'hold' : (b.capW >= 0.5 ? 'talk' : (b.holdW || b.capW || netD ? 'talk' : 'talk')));
      b.momentum = momentumOf(b);
      b.cls = classify(b);
      b.reasons = reasonBundle(b);
    });
    cache.agg = res;
    return res;
  }

  // recency-bucket momentum from actual post ages (#6/#7/#30)
  function bucketW(b, kind) {
    const cut = kind === 'in' ? x => x.inW : kind === 'cap' ? x => x.capW : x => x.outW;
    const T = { w12: 0, w1224: 0, w2448: 0, w4872: 0, w72: 0 };
    b.posts.forEach(p => {
      const w = INTENT_W[p.intent] || 0; const ew = effW(p.author); if (!w) return;
      const has = p.ents && p.ents.some(e => kind === 'in' ? e === 'in' : kind === 'cap' ? e === 'cap' : e === 'out');
      if (!has || !isIndependent(p)) return;
      const h = hAgo(p.ts);
      const v = w * ew;
      if (h < 12) T.w12 += v; else if (h < 24) T.w1224 += v; else if (h < 48) T.w2448 += v; else if (h < 72) T.w4872 += v; else T.w72 += v;
    });
    return T;
  }
  function momentumOf(b) {
    // track whichever side is dominant: net-selling players get sell-momentum
    const T = bucketW(b, 'in'), C = bucketW(b, 'cap'), O = bucketW(b, 'out');
    const sell = b.outW > b.inW && b.outW > b.capW;
    let now, prev;
    if (sell) { now = O.w12; prev = O.w1224; }
    else { now = T.w12 + C.w12; prev = T.w1224 + C.w1224; }
    const pct = prev > 0 ? Math.round(100 * (now - prev) / prev) : (now > 0 ? 999 : 0);
    return { now, prev, pct, dir: now > prev ? 'up' : now < prev ? 'down' : 'flat', T, C, O };
  }
  function fmtM(m) {
    if (m.dir === 'up') return m.pct === 999 ? '▲ new interest' : '▲ +' + m.pct + '%';
    if (m.dir === 'down') return '▼ ' + m.pct + '%';
    return '▬ flat';
  }

  // ---------- classification (#18) ----------
  function classify(b) {
    const own = b.own;
    if (b.avoidW >= b.inW && b.outW + b.avoidW > b.inW * 0.6 && own >= 15) return 'Avoided';
    if (b.outW > b.inW * 1.3 && own >= 30) return 'Template fading / sold';
    if (b.outW > b.inW && own < 30) return 'Sell wave (low-owned)';
    if (b.inW > b.outW) {
      if (own >= 45) return b.age < 30 ? 'Late-consensus (already owned)' : 'Elite Template';
      if (own >= 20) return b.momentum.dir === 'up' ? 'Entering template' : 'Template player';
      return 'Elite Differential';
    }
    if (b.holdW >= b.inW && b.holdW >= b.outW) return 'Held by elites';
    return 'Discussion';
  }

  // ---------- evidence & hype (#14) ----------
  function adjAvg(P) {
    const TF = D.teamsByShort || {};
    const t = TF[P.team]; if (!t || !t.afx) return 3;
    const f = (P.next3 || []).map((x, i) => { const v = (t.afx[i] != null) ? t.afx[i] : x.fdr; return Math.max(1, Math.min(5, v)); });
    return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 3;
  }
  function evidence(P) {
    const fm = Math.min(P.form || 0, 10) / 10;
    const ep = Math.min(P.ep_next || 0, 10) / 10;
    const xgi = Math.min((P.xg || 0) + (P.xa || 0), 3.2) / 3.2;
    const mi = Math.min((P.mins || 0), 270) / 270;
    const aa = adjAvg(P);
    const fx = aa <= 2 ? 1 : aa <= 2.5 ? 0.88 : aa <= 3 ? 0.7 : aa <= 3.5 ? 0.5 : 0.32;
    const TF = D.teamsByShort || {}; const t = TF[P.team] || {};
    const rk = t.rank || 10;
    const team = rk <= 4 ? 0.95 : rk <= 8 ? 0.85 : rk <= 12 ? 0.7 : rk <= 16 ? 0.55 : 0.4;
    return Math.round(100 * (0.24 * fm + 0.24 * ep + 0.16 * xgi + 0.10 * mi + 0.16 * fx + 0.10 * team));
  }
  function hypeOf(b) { return b ? Math.round(Math.min(1, (b.buzz || 0) / 6) * 100) : 0; }

  function finalScore(b) {
    const ev = b.evidence, hy = hypeOf(b);
    if (!b || b.nAuth < 2 && !(b.capW + b.inW)) return null;
    return { evidence: ev, hype: hy, final: Math.round(0.62 * ev + 0.38 * hy), captain: b.capW ? Math.round(Math.min(100, 0.5 * b.capW * 100 / 3.5 + 0.5 * ev)) : null };
  }

  // ---------- reason bundle: X-side + data-side, never invented ----------
  function reasonBundle(b) {
    const list = []; const X = {};
    b.posts.forEach(p => { if (!isIndependent(p)) return; const w = INTENT_W[p.intent] || 0; if (!w) return;
      const rks = reasonsOf(p);
      rks.forEach(k => { X[k] = X[k] || { w: 0, n: 0, authors: {} }; X[k].w += w * effW(p.author); X[k].n++; X[k].authors[p.author] = 1; }); });
    Object.keys(X).forEach(k => list.push({ k, label: REASON_LABEL(k), w: X[k].w, n: X[k].n, a: Object.keys(X[k].authors).length, src: 'X' }));
    // data-side reasons (only from actual player numbers)
    const P = b.P, aa = adjAvg(P);
    if ((P.mins || 0) >= 250) list.push({ k: 'fullmin', label: 'Full-minutes profile', w: 0.6, n: 1, a: 1, src: 'data', v: P.mins + '/270 mins' });
    if ((P.xg || 0) + (P.xa || 0) >= 2.2) list.push({ k: 'xgiok', label: 'Strong season xGI', w: 0.6, n: 1, a: 1, src: 'data', v: '+' + ((P.xg || 0) + (P.xa || 0)).toFixed(2) });
    if (aa <= 2.5) list.push({ k: 'fixok', label: 'Kind upcoming fixtures', w: 0.6, n: 1, a: 1, src: 'data', v: 'avg ' + aa.toFixed(1) });
    if ((P.form || 0) >= 7) list.push({ k: 'formok', label: 'Red-hot form', w: 0.5, n: 1, a: 1, src: 'data', v: P.form + '/10' });
    if (aa >= 3.6) list.push({ k: 'fixbad', label: 'Tough upcoming fixtures', w: 0.6, n: 1, a: 1, src: 'data', v: 'avg ' + aa.toFixed(1) });
    list.sort((x, y) => y.w - x.w || y.a - x.a);
    return list.slice(0, 8);
  }

  // ---------- captaincy consensus (#8/#9/#10) ----------
  function captaincy() {
    const r = agg(); const rows = Object.values(r.byPlayer).filter(b => b.capW > 0).sort((a, b) => b.capW - a.capW);
    const tot = rows.reduce((s, x) => s + x.capW, 0);
    return rows.slice(0, 8).map(b => ({ b, share: tot ? Math.round(100 * b.capW / tot) : 0, conf: b.confCap.length, cons: b.consCap.length }));
  }
  function campReasons(name) {
    const r = agg(); const b = r.byPlayer[name]; if (!b) return [];
    const m = {};
    b.posts.forEach(p => { if (!isIndependent(p)) return; const w = INTENT_W[p.intent] || 0; if (!w || !(p.ents || []).includes('cap')) return;
      reasonsOf(p).forEach(k => { m[k] = (m[k] || 0) + w * effW(p.author); }); });
    return Object.keys(m).sort((x, y) => m[y] - m[x]).slice(0, 4).map(k => REASON_LABEL(k));
  }

  // ---------- chip trends (#16) ----------
  function chips() {
    const r = agg();
    const by = {};
    (D.xint.posts || []).forEach(p => {
      if (p.category !== 'chip') return;
      const w = INTENT_W[p.intent] || 0; if (!w) return;
      const keys = [];
      if (/wildcard|\bwc\b/i.test(p.text) || (p.ents || []).includes('wc')) keys.push('Wildcard');
      if (/free hit|\bfh\b/i.test(p.text) || (p.ents || []).includes('fh')) keys.push('Free Hit');
      if (/bench boost|\bbb\b/i.test(p.text) || (p.ents || []).includes('bench boost')) keys.push('Bench Boost');
      if (/triple captain|\btc\b/i.test(p.text) || (p.ents || []).includes('tc')) keys.push('Triple Captain');
      keys.forEach(k => { by[k] = by[k] || { w: 0, auth: {}, n: 0 }; by[k].w += w * effW(p.author); by[k].auth[p.author] = 1; by[k].n++; });
    });
    const tot = Object.values(by).reduce((s, x) => s + x.w, 0);
    return Object.keys(by).map(k => ({ k, ...by[k], pct: tot ? Math.round(100 * by[k].w / tot) : 0, auth: Object.keys(by[k].auth).length }));
  }

  // ---------- transfer battle (#11) ----------
  function transferBattle(a, b) {
    const r = agg(); const A = r.byPlayer[a], B = r.byPlayer[b];
    if (!A || !B) return null;
    return { a, b, Ain: A.inW, Aout: A.outW, Bin: B.inW, Bout: B.outW,
      Anet: A.inW - A.outW, Bnet: B.inW - B.outW,
      AconfIn: A.confIn.length, AconfOut: A.confOut.length, BconfIn: B.confIn.length, BconfOut: B.confOut.length,
      Acl: A.cls, Bcl: B.cls };
  }

  // ---------- contrarians (#15) ----------
  function contrarians() {
    const r = agg(); const out = [];
    Object.values(r.byPlayer).forEach(b => {
      if (b.outW > b.inW && b.holdW > 0) {
        const keepers = b.confHold.concat(b.consIn && []); // retainers confirmed or leaning
        const ids = Object.keys(b.authors).filter(h => {
          const a = acc(h); if (!a || a.tier > 2) return false;
          return b.posts.some(p => p.author === h && isIndependent(p) && (p.ents || []).includes('hold'));
        });
        if (ids.length) out.push({ name: b.P.name, dir: 'retain vs sell', accounts: ids, ev: b.evidence, why: b.reasons.filter(x => x.src === 'X').slice(0, 2).map(x => x.label) });
      }
      if (b.inW > b.outW && b.avoidW + b.outW > 0) {
        const ids = Object.keys(b.authors).filter(h => { const a = acc(h); return a && a.tier <= 2 && b.posts.some(p => p.author === h && isIndependent(p) && ((p.ents || []).includes('avoid') || (p.ents || []).includes('out'))); });
        if (ids.length) out.push({ name: b.P.name, dir: 'wary vs buy', accounts: ids, ev: b.evidence, why: b.reasons.filter(x => x.src === 'X').slice(0, 2).map(x => x.label) });
      }
    });
    return out;
  }

  // ---------- template (#17) ----------
  function template() {
    const r = agg(); const pos = { GK: [], DEF: [], MID: [], FWD: [] };
    Object.values(r.byPlayer).forEach(b => {
      const P = b.P; if (!pos[P.pos]) return;
      pos[P.pos].push({ name: P.name, team: P.team, ...b, score: b.capW * 0.6 + b.holdW * 0.5 + b.inW });
    });
    const pick = { GK: 1, DEF: 4, MID: 5, FWD: 3 };
    const out = {};
    Object.keys(pick).forEach(p => {
      out[p] = pos[p].sort((a, b) => b.score - a.score).slice(0, pick[p]).filter(x => x.score > 0.01)
        .map(x => ({ name: x.name, team: x.team, cls: x.cls, own: x.own, share: Math.min(100, Math.round(100 * x.score / 4)), elite: x.eliteAuth }));
    });
    return out;
  }

  // ---------- hype-vs-evidence flags (#13/#14) ----------
  function hypeFlags() {
    const r = agg(); const out = [];
    Object.values(r.byPlayer).forEach(b => {
      const hy = hypeOf(b);
      if (hy < 55 || b.evidence == null) return;
      const gap = b.evidence - hy;
      const eliteNet = b.inW - b.outW + b.capW * 0.5;
      // trap: creators/community make noise, model is weak, elites not backing it
      if (gap < -16 && b.evidence < 60 && eliteNet < b.outW * 2 + 1.2) {
        out.push({ name: b.P.name, hy, ev: b.evidence, kind: 'trap' });
      }
      // noise: loud, weak-ish model, and almost NO elite (T1/T2) action at all
      else if (gap < -16 && b.evidence >= 45 && b.evidence < 62 && b.eliteAuth === 0 && b.momentum.dir === 'up') {
        out.push({ name: b.P.name, hy, ev: b.evidence, kind: 'noise' });
      }
      // healthy-hot is NOT flagged: loud + real elite action + decent model = consensus forming
    });
    // late-consensus flags (#13) — buzz arriving AFTER ownership already ballooned
    Object.values(r.byPlayer).forEach(b => {
      if (b.own >= 40 && b.age < 30 && (b.inW > 0 || b.capW > 0) && b.nAuth >= 1) {
        out.push({ name: b.P.name, own: b.own, kind: 'late', hy: hypeOf(b), ev: b.evidence });
      }
    });
    return out;
  }

  // ---------- top-level stats for data-quality header (#35) ----------
  function metaInfo() {
    const r = agg();
    const elites = new Set(); const all = new Set();
    Object.values(r.byPlayer).forEach(b => Object.keys(b.authors).forEach(h => { const a = acc(h); if (a && a.tier === 1) elites.add(h); all.add(h); }));
    const freshN = { fresh: 0, aging: 0, old: 0, stale: 0 };
    (D.xint.posts || []).forEach(p => freshN[fresh(p.ts, /news/i.test(p.category || '')).k]++);
    return { accounts: (D.xint.accounts || []).length, t1: elites.size, authors: all.size,
      posts: (D.xint.posts || []).length, indep: r.indep || 0,
      elitePosters: [...elites].length, updated: ageTxt(D.xint.meta.generated || new Date().toISOString()),
      completeness: D.xint.meta.completeness || 0, mode: D.xint.meta.mode || 'off', freshN,
      target_gw: D.xint.meta.target_gw, deadline: D.xint.meta.deadline || '',
      provider: D.xint.meta.provider || '' };
  }

  // ---------- personal team integration (#28) ----------
  function teamSig() {
    const r = agg(); const ctx = (typeof window !== 'undefined' && window.TEAMCTX) || null;
    const owned = ctx && ctx.squad ? ctx.squad.map(s => s.e && s.e.n).filter(Boolean) : [];
    const rows = [];
    owned.forEach(nm => { const b = r.byPlayer[nm]; if (!b) return;
      rows.push({ name: nm, b, ev: b.evidence, dirs: b.dirs, cls: b.cls, mom: fmtM(b.momentum),
        eliteSell: b.outW > b.inW * 1.2, eliteBuy: b.inW > b.outW * 1.2 });
    });
    const buys = Object.values(r.byPlayer).filter(b => b.inW > b.outW).sort((a, b) => (b.inW - b.outW) - (a.inW - a.outW)).slice(0, 4)
      .map(b => ({ name: b.P.name, team: b.P.team, pos: b.P.pos, net: (b.inW - b.outW), cls: b.cls }))
      .filter(x => owned.indexOf(x.name) < 0);
    return { owned, rows, buys, hasTeam: owned.length > 0 };
  }

  // ============================ PUBLIC ============================
  const api = {
    init(data) {
      D = data || {};
      D.xint = D.xint || { meta: {}, accounts: [], posts: [], calls: [] };
      D.teamsByShort = {};
      (D.teams || []).forEach(t => { D.teamsByShort[t.short] = t; });
      D.maxGw = (D.meta && D.meta.latest_gw) || 3;
      cache.acc = {}; cache.mets = {}; cache.agg = null;
      ok = true; return api;
    },
    ready() { return ok; },
    data: () => D,
    agg: () => { api._ensure(); return agg(); },
    captaincy: () => { api._ensure(); return captaincy(); },
    campReasons: (n) => { api._ensure(); return campReasons(n); },
    chips: () => { api._ensure(); return chips(); },
    battle: (a, b) => { api._ensure(); return transferBattle(a, b); },
    contrarians: () => { api._ensure(); return contrarians(); },
    template: () => { api._ensure(); return template(); },
    hypeFlags: () => { api._ensure(); return hypeFlags(); },
    metaInfo: () => { api._ensure(); return metaInfo(); },
    teamSig: () => { api._ensure(); return teamSig(); },
    buzz: (name) => { api._ensure(); const b = agg().byPlayer[name]; return b ? hypeOf(b) : 0; },
    plr, acc, effW, accScore, fresh, ageTxt, hAgo, evidence, adjAvg,
    finalScore: (name) => { api._ensure(); return finalScore(agg().byPlayer[name]); },
    fmtM: m => fmtM(m),
    labelOf: k => REASON_LABEL(k),
    classifyOf: n => { api._ensure(); const b = agg().byPlayer[n]; return b ? b.cls : null; },
    _ensure() { if (!ok) api.init(typeof DATA !== 'undefined' ? DATA : {}); },
    _reset() { cache.agg = null; },
  };
  return api;
})();

// ============================================================================
// 🧠 XINT — renderers, GW report, natural-language layer (DOM layer)
// ============================================================================
const H = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const XT2 = { t: 'x' }; // namespace placeholder (keeps diffs clean)

function xBar(pct, color) {
  const p = Math.max(2, Math.min(100, pct || 0));
  return `<div class="x-bar"><div class="x-fill" style="width:${p}%;background:${color || 'var(--green)'}"></div></div>`;
}
function xSpark(b) {
  const w = b.momentum;
  const vals = [w.T.w72, w.T.w4872, w.T.w1224, w.T.w12];
  const mx = Math.max(1, ...vals);
  const cols = vals.map((v, i) => `<div class="x-col" style="height:${Math.max(3, 100 * v / mx)}%" title="${[">72h", "48-72h", "24-48h", "0-24h"][i]} interest ${v.toFixed(2)}"></div>`).join('');
  return `<div class="x-spark">${cols}</div>`;
}
function intentBadge(i) {
  const c = { action: 'var(--green)', lean: 'var(--amber)', weak: '#8fa3c9', neutral: 'var(--muted)' }[i] || 'var(--muted)';
  return `<span class="xb xb-int" style="--c:${c}">${H(i)}</span>`;
}
function tierBadge(a) {
  const c = { 1: 'var(--green)', 2: '#4cc9ff', 3: 'var(--amber)', 4: 'var(--muted)' }[a.tier] || 'var(--muted)';
  return `<span class="xb" style="--c:${c}">T${a.tier}</span>`;
}

// ---------- data quality header ----------
function xDq() {
  const m = XT.metaInfo();
  const live = m.mode === 'live';
  const modeBadge = live ? '<span class="xb xb-live" style="--c:var(--green)">● LIVE X FEED</span>'
    : m.mode === 'demo' ? '<span class="xb" style="--c:var(--amber)">● CURATED DEMO FEED</span>'
    : '<span class="xb" style="--c:var(--red)">● X DATA OFF</span>';
  const f = m.freshN;
  return `<div class="card x-card" style="border-color:var(--line)">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">
      <div>
        <h2 style="margin-bottom:4px">🧠 X Intelligence <span class="muted">— how elite FPL managers are thinking · GW${H(m.target_gw)}</span></h2>
        <p class="muted" style="margin:0">Deadline ${H(m.deadline || '—')} · data window ${H(m.provider)}</p>
      </div>
      <div style="text-align:right">${modeBadge}<div class="muted" style="margin-top:4px">updated ${H(m.updated)} ago</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px" class="x-dq">
      <div class="dq"><b>${m.accounts}</b><span>accounts analysed</span></div>
      <div class="dq"><b>${m.posts}</b><span>relevant posts</span></div>
      <div class="dq"><b>${m.indep}</b><span>independent signals</span></div>
      <div class="dq"><b>${m.t1}</b><span>tier-1 elites active</span></div>
      <div class="dq"><b>${m.completeness}%</b><span>completeness</span></div>
      <div class="dq"><b class="${f.fresh ? '' : ''}">🟢${f.fresh} 🟡${f.aging} 🟠${f.old} 🔴${f.stale}</b><span>freshness by post</span></div>
    </div>
    <p class="muted" style="margin:10px 0 0">Freshness windows: <b style="color:var(--green)">🟢 &lt;6h</b> · <b style="color:var(--amber)">🟡 6-24h</b> · <b style="color:#ff9d5c">🟠 24-48h</b> · <b style="color:var(--red)">🔴 &gt;48h</b> — team-news/injury posts decay 2× faster. <span style="color:#ff9d5c">${live ? '' : 'This is a simulated demo feed (fictional accounts, no real quotes). Hook up ingest_x.py with X API credentials to replace it with live elite-manager posts — the engine needs no rebuild.'}</span></p>
  </div>`;
}

// ---------- pulse cards ----------
function xPulse() {
  const r = XT.agg(); const bs = Object.values(r.byPlayer);
  const has = b => b.nAuth >= 1;
  const top = (f) => bs.filter(has).sort((a, b) => f(b) - f(a))[0];
  const mostBought = top(b => b.inW);
  const mostSold = top(b => b.outW);
  const capList = XT.captaincy();
  const capLead = capList[0];
  const rising = bs.filter(has).sort((a, b) => (b.momentum.pct === 999 ? 1e9 : b.momentum.pct) - (a.momentum.pct === 999 ? 1e9 : a.momentum.pct))[0];
  const falling = bs.filter(has && (b => b.momentum.pct < 0)).sort((a, b) => a.momentum.pct - b.momentum.pct)[0];
  const diff = bs.filter(b => b.cls === 'Elite Differential').sort((a, b) => (b.inW - b.outW) - (a.inW - a.outW))[0];
  const flags = XT.hypeFlags();
  const trap = flags.find(f => f.kind === 'trap');
  const cont = XT.contrarians();

  const card = (icon, title, body, color) => `<div class="card x-pulse"><div class="xp-ic">${icon}</div>
    <div style="flex:1"><div class="xp-t" style="color:${color || 'var(--txt)'}">${title}</div>${body}</div></div>`;
  const pl = (b) => b ? `<b>${H(b.P.name)}</b> <span class="muted">${b.P.team} · ${b.P.pos}</span><br>
    <span class="muted">net ${(b.inW - b.outW).toFixed(1)}w ${b.nAuth ? '· ' + b.nAuth + ' voices' : ''} ${fmtWide(b)}</span>` : '—';
  const plCap = (row) => row ? `<b>${H(row.b.P.name)}</b> <span class="muted">${row.b.P.team}</span> <b style="color:var(--green)">${row.share}%</b><br><span class="muted">${row.conf} confirmed · ${row.cons} considering</span>` : '—';
  return `<div class="grid3">
    ${card('🔥', 'Most bought', pl(mostBought), 'var(--green)')}
    ${card('🔻', 'Most sold', pl(mostSold), 'var(--red)')}
    ${card('🎯', 'Captaincy leader', plCap(capLead))}
    ${card('📈', 'Fastest rising', rising ? `<b>${H(rising.P.name)}</b> <span class="up">${XT.fmtM(rising.momentum)}</span><br><span class="muted">12h signal momentum</span>` : '—')}
    ${card('📉', 'Fastest falling', falling ? `<b>${H(falling.P.name)}</b> <span class="down">${XT.fmtM(falling.momentum)}</span><br><span class="muted">declining elite interest</span>` : '—')}
    ${card('💎', 'Emerging differential', diff ? `<b>${H(diff.P.name)}</b> <span class="muted">${diff.P.team}</span><br><span class="muted">low ownership · rising elite IN</span>` : '—')}
    ${card('⚠️', trap ? 'Hype not backed by data' : 'Biggest risk', trap ? `<b>${H(trap.name)}</b> · hype ${trap.hy} vs model ${trap.ev}<br><span class="muted">X buzz ahead of the FPL data</span>` : '—', 'var(--amber)')}
    ${card('🧭', 'Contrarian watch', cont.length ? cont.slice(0, 3).map(c => `${H(c.name)} <span class="muted">(${H(c.dir)})</span>`).join('<br>') : '—')}
  </div>`;
}
function fmtWide(b) { return b.dirs === 'in' ? '▲ buying' : b.dirs === 'out' ? '▼ selling' : b.dirs === 'hold' ? 'held' : 'talk'; }

// ---------- transfer trends & battles ----------
function xTrends() {
  const r = XT.agg();
  const rows = Object.values(r.byPlayer)
    .filter(b => (b.inW + b.outW) > 0.01 || b.capW > 0)
    .sort((a, b) => (b.inW - b.outW) - (a.inW - a.outW))
    .map(b => {
      const net = b.inW - b.outW;
      const tot = b.inW + b.outW;
      const pctIn = tot ? Math.round(100 * b.inW / tot) : 0;
      const m = b.momentum;
      const conf = net > 0 ? `<b class="up">${b.confIn.length}</b>` : net < 0 ? `<b class="down">${b.confOut.length}</b>` : '0';
      const color = net >= 0 ? 'var(--green)' : 'var(--red)';
      const arrow = m.dir === 'up' ? '<span class="up">▲</span>' : m.dir === 'down' ? '<span class="down">▼</span>' : '<span class="muted">▬</span>';
      const lvl = b.nAuth >= 3 && b.eliteAuth >= 1 ? 'High' : b.nAuth >= 2 ? 'Medium' : 'Low';
      return `<tr><td><b>${H(b.P.name)}</b> <span class="team-tag">${b.P.team}</span><br><span class="xb cls">${H(b.cls)}</span></td>
        <td class="num">${b.inW.toFixed(1)}</td><td class="num">${b.outW.toFixed(1)}</td>
        <td class="num"><b style="color:${color}">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b></td>
        <td style="min-width:130px">${xBar(pctIn, net >= 0 ? 'var(--green)' : 'var(--red)')}</td>
        <td class="num">${conf}</td>
        <td>${arrow} <span class="muted">${XT.fmtM(m)}</span></td>
        <td>${lvl}</td></tr>`;
    }).join('');
  const battleA = XT.battle('Haaland', 'B.Fernandes') || XT.battle('Isak', 'B.Fernandes');
  const bt = battleA ? battleCard(battleA) : '';
  return `<div class="grid2" style="grid-template-columns:1.9fr 1fr">
    <div class="card" style="overflow-x:auto">
      <h2>Transfer trends — elite signals <span class="muted">(weighted by credibility, not raw posts)</span></h2>
      <table class="data compact"><tr><th>Player</th><th class="num">Elite IN</th><th class="num">Elite OUT</th><th class="num">Net</th><th>IN share</th><th class="num">Confirmed</th><th>Δ 12h</th><th>Confidence</th></tr>${rows}</table>
      <p class="muted" style="margin:8px 0 0">Weights: T1 1.00 · T2 0.85 · T3 0.65 · T4 0.20 × measured accuracy. Echoes of the same claim count once.</p>
    </div>
    <div>${bt}</div></div>`;
}
function battleCard(tb) {
  const row = (n, w) => { const side = w.net >= 0 ? 'buy' : 'sell'; return `<div class="bt-row ${side}">
      <div style="display:flex;justify-content:space-between"><b>${H(n)}</b><b style="color:${w.net >= 0 ? 'var(--green)' : 'var(--red)'}">${w.net >= 0 ? '+' : ''}${w.net.toFixed(1)} net</b></div>
      <div class="muted">IN ${w.in.toFixed(1)}w · OUT ${w.out.toFixed(1)}w · ${w.confIn} confirmed in / ${w.confOut} out</div>
      <div style="display:flex;gap:8px;margin-top:4px">${xBar(Math.round(100 * w.in / Math.max(.01, w.in + w.out)), w.net >= 0 ? 'var(--green)' : 'var(--red)')}</div></div>`; };
  return `<div class="card"><h2>⚔️ Transfer Battle <span class="muted">${H(tb.a)} vs ${H(tb.b)}</span></h2>
    ${row(tb.a, { net: tb.Anet, in: tb.Ain, out: tb.Aout, confIn: tb.AconfIn, confOut: tb.AconfOut })}
    ${row(tb.b, { net: tb.Bnet, in: tb.Bin, out: tb.Bout, confIn: tb.BconfIn, confOut: tb.BconfOut })}
    <p class="muted" style="margin:8px 0 0">Why? See player cards below — every reason is from X discussion text or your FPL data.</p></div>`;
}

// ---------- captaincy ----------
function xCaptaincy() {
  const list = XT.captaincy();
  if (!list.length) return `<div class="card"><p class="hint">Insufficient X data — no captaincy signals in the current window.</p></div>`;
  const top1 = list[0], top2 = list[1];
  const split = top2 && top1.share - top2.share <= 18 && top2.share >= 10;
  const rows = list.map(rr => {
    const m = rr.b.momentum;
    const d = m.dir === 'up' ? '<span class="up">▲</span>' : m.dir === 'down' ? '<span class="down">▼</span>' : '<span class="muted">▬</span>';
    const mom = m.dir === 'up' ? `+${m.pct === 999 ? 'new' : m.pct + '%'}` : m.dir === 'down' ? `${m.pct}%` : 'flat';
    return `<div class="cap-row">
      <div style="display:flex;justify-content:space-between"><b>${H(rr.b.P.name)}</b> <span class="muted">${H(rr.b.P.team)}</span>
      <b style="color:var(--green)">${rr.share}%</b> <span class="${m.dir === 'up' ? 'up' : m.dir === 'down' ? 'down' : 'muted'}">${d} ${mom}</span></div>
      ${xBar(rr.share, 'var(--green)')}
      <div class="muted">${rr.conf} confirmed · ${rr.cons} considering · ${rr.b.eliteAuth} elite accounts · ${xSpark(rr.b)}</div>
    </div>`;
  }).join('');
  const camps = split ? `<div class="card" style="grid-column:1/-1">
      <h2>⚠️ Elite managers are split</h2>
      <p class="hint">${H(top1.b.P.name)} ${top1.share}% vs ${H(top2.b.P.name)} ${top2.share}% — captaincy is a genuine disagreement this GW, not a consensus.</p>
      <div class="grid2"><div class="card"><h2 style="color:var(--green)">${H(top1.b.P.name)} camp</h2><ul class="why">${XT.campReasons(top1.b.P.name).map(r => '<li>' + H(r) + '</li>').join('')}</ul>
        <p class="muted">Leading accounts: ${top1.b.confCap.slice(0, 4).map(h => H(h)).join(', ')}</p></div>
      <div class="card"><h2 style="color:#4cc9ff">${H(top2.b.P.name)} camp</h2><ul class="why">${XT.campReasons(top2.b.P.name).map(r => '<li>' + H(r) + '</li>').join('')}</ul>
        <p class="muted">Leading accounts: ${top2.b.confCap.slice(0, 4).map(h => H(h)).join(', ')}</p></div></div></div>` : '';
  return `<div class="card"><h2>Elite Captaincy Consensus — GW${H(XT.metaInfo().target_gw)}</h2>
    <p class="hint">${split ? '⚠️ Split — see camps below.' : `Consensus: <b>${H(top1.b.P.name)}</b> leads at ${top1.share}%.`} Weighted by credibility + confirmed vs intention. Never read these as the final word — the model check below is independent.</p>
    <div class="cap-wrap">${rows}</div>
    ${camps}</div>`;
}

// verdict per player state — keeps the "should I care?" answer honest
function xRec(b, ev, hy, gap) {
  const late = /Late-consensus/.test(b.cls);
  const avoid = /Avoided|fading|Sell wave/.test(b.cls);
  if (late) return `<span class="x-verdict amber">⚠️ Elite buzz is loud AND ownership is already ${b.own}% — this is late consensus, not an early edge. If you own him, fine; buying now chases the crowd. Model ${ev}/100: real support, no edge left.</span>`;
  if (b.dirs === 'out') return `<span class="x-verdict red">Elite trend: selling. ${ev >= 70 ? 'Model still rates him (fixture/price-driven, not form) — check whether their reason applies to your squad.' : 'Model agrees (' + ev + '/100) — the exit has data behind it.'}</span>`;
  if (b.dirs === 'hold') return `<span class="x-verdict blue">Elites are holding — ${b.confHold.length ? b.confHold.length + ' confirmed' : 'no exit signals'}. Model ${ev}/100. No forced move.</span>`;
  if (hy != null && ev != null) {
    if (hy >= 70 && ev >= 72 && gap > -18) return `<span class="x-verdict green">🔥 Loud AND supported: model ${ev}/100 agrees with the elite move. Genuine consensus — but loud also means the cheap entry has passed.</span>`;
    if (gap <= -18 && ev >= 70) return `<span class="x-verdict amber">💬 Buzz runs ahead of the model (hype ${hy}, model ${ev}) — mostly a volume effect while elite action stays measured. Not a red flag, not a green light.</span>`;
    if (gap <= -18 && ev < 70) return `<span class="x-verdict amber">⚠️ X hype ahead of the model — ${ev < 55 ? 'model ' + ev + '/100: look, don\u2019t leap.' : 'model ' + ev + '/100: the fixture/minutes case is weaker than the buzz.'}</span>`;
    if (gap >= 14) return `<span class="x-verdict green">💎 Quiet elite interest with strong model support (${ev}/100) — an under-hyped edge, not a crowd play.</span>`;
  }
  return `<span class="x-verdict blue">Model ${ev != null ? ev + '/100' : 'n/a'} — no elite exit signal.</span>`;
}
function xPlayersHead(b) { return true; }
// ---------- player cards (trend + why + hype vs evidence) ----------
function xPlayers() {
  const r = XT.agg();
  const meaningful = b => (b.inW + b.outW + b.capW + b.holdW + b.avoidW) > 0.02 || b.confCap.length > 0;
  const rows = Object.values(r.byPlayer)
    .filter(meaningful)
    .sort((a, b) => (Math.abs(b.inW - b.outW) + b.capW * 0.5) - (Math.abs(a.inW - a.outW) + a.capW * 0.5));
  const cards = rows.map(b => {
    const P = b.P; const net = b.inW - b.outW;
    const f = XT.finalScore(P.name) || {};
    const ev = f.evidence, hy = f.hype, fin = f.final;
    const gap = (ev != null && hy != null) ? ev - hy : 0;
    const gw = (P.next3 || []).slice(0, 3).map(fx => `<span class="fdr f${Math.min(5, Math.max(1, fx.adjv ?? fx.fdr))}" title="GW${fx.gw}">${fx.gw}:${fx.opp}${fx.ha === 'H' ? '(H)' : '(A)'}</span>`).join(' ');
    const why = b.reasons.map(x => `<span class="xb reason ${x.src === 'data' ? 'rd' : ''}" title="${x.src === 'data' ? 'from FPL data' : 'cited from X discussion'}">${x.n > 1 ? x.n + '× ' : ''}${H(x.label)}${x.src === 'data' ? ' 📊' : ''}</span>`).join(' ');
    const rec = xRec(b, ev, hy, gap);
    const capNote = b.capW > 0 ? `<span class="muted">Captaincy signals: ${b.confCap.length} confirmed · ${(b.consCap.length || 0)} considering</span>` : '';
    const mom = XT.fmtM(b.momentum);
    const color = net >= 0 ? 'var(--green)' : 'var(--red)';
    return `<div class="card x-plc">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div><b style="font-size:15px">${H(P.name)}</b> <span class="team-tag">${H(P.team)} · ${P.pos} · £${P.cost}m · ${P.own}% own</span>
          <div style="margin:4px 0 2px"><span class="xb cls">${H(b.cls)}</span> <span class="muted">${mom}</span></div>
          <div style="display:flex;gap:4px;flex-wrap:wrap">${gw}</div></div>
        <div style="text-align:right;min-width:150px">
          <div class="muted" style="font-size:11px">FPL model</div><div class="x-big" style="color:var(--green)">${ev ?? '—'}/100</div>
          <div class="muted" style="font-size:11px">X hype</div><div class="x-big" style="color:${gap <= -18 ? 'var(--red)' : 'var(--amber)'}">${hy ?? '—'}/100</div>
          ${fin ? `<div class="muted" style="font-size:11px">Final AI rating (62/38 data/X)</div><div class="x-big">${fin}/100</div>` : ''}
        </div>
      </div>
      ${rec}
      <div class="x-inout" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
        <span>IN <b style="color:${net >= 0 ? 'var(--green)' : 'var(--txt)'}">${b.inW.toFixed(1)}w</b> <span class="muted">(${b.confIn.length} confirmed · ${b.consIn.length} considering)</span></span>
        <span>OUT <b style="color:${net < 0 ? 'var(--red)' : 'var(--txt)'}">${b.outW.toFixed(1)}w</b> <span class="muted">(${b.confOut.length} confirmed)</span></span>
        <span>Net <b style="color:${color}">${net >= 0 ? '+' : ''}${net.toFixed(1)}</b></span>
        ${capNote}
      </div>
      <div class="muted" style="margin-top:6px">Why? ${why || '<span class="muted">— no X-cited reasons yet</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="grid2"><h2 style="grid-column:1/-1">Trending players — what, how much, why, should I care?</h2>${cards}</div>`;
}

// ---------- voices & debates ----------
function xVoices() {
  const r = XT.agg();
  const echoBy = {};
  (Dx() || []).forEach(p => { if (p.origin && p.origin !== 'self' && p.origin !== p.id) echoBy[p.id] = p.origin; });
  const feed = XT.data().xint.posts || [];
  const order = feed.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const rows = order.map(p => {
    const a = XT.acc(p.author);
    const fr = XT.fresh(p.ts, /news|injur/i.test(p.category || ''));
    const echo = p.origin && p.origin !== 'self' && p.origin !== p.id ? `<span class="xb" style="--c:#8fa3c9">echo of ${H(p.origin)}</span>` : '';
    const srcT = { decision: 'Decision', analysis: 'Analysis', opinion: 'Opinion', discussion: 'Discussion' }[p.source_kind] || H(p.source_kind);
    const pl = (p.players || []).map(n => `<span class="xb">${H(n)}</span>`).join(' ');
    const eng = p.engagement || {};
    const link = p.links && p.links.length ? `<a href="${H(p.links[0])}" target="_blank" rel="noopener">🔗</a>` : '';
    return `<div class="voice"><div class="v-h">
        <span class="v-a">${H(p.author)}</span> ${a ? tierBadge(a) + ' <span class="muted">' + H(a.category) + ' · ' + XT.accScore(p.author) + '/100 rel · ' + (a.followers > 999 ? (a.followers / 1000).toFixed(0) + 'k' : a.followers) + ' followers</span>' : ''}
        <span style="margin-left:auto" class="muted">${ageTxt(p.ts)} ago</span> <span class="xd" style="color:${fr.c}" title="${fr.t}">●</span> ${fr.t}</div>
      <div class="v-text">${H(p.text)} ${link}</div>
      <div class="v-meta">${intentBadge(p.intent)} <span class="xb">${H(p.category)}</span> <span class="xb">${H(srcT)}</span> ${echo} ${pl} ${p.kind !== 'post' ? '<span class="xb">' + H(p.kind) + '</span>' : ''}
        <span class="muted" style="margin-left:auto">👁 ${fmtK(eng.views || 0)} · 🔁 ${fmtK(eng.reposts || 0)} · ❤ ${fmtK(eng.likes || 0)}</span></div>
    </div>`;
  }).join('');
  const cont = XT.contrarians();
  const contHtml = cont.length ? `<div class="card" style="margin-top:14px"><h2>🧭 Contrarian signals — where elites disagree with the crowd</h2>
    ${cont.map(c => `<div class="v-cont"><b>${H(c.name)}</b> — <span class="muted">${H(c.dir)}:</span> ${c.accounts.map(h => H(h) + ' (' + XT.accScore(h) + ')').join(', ')}
      <div class="muted">Why: ${(c.why || []).join(', ') || '—'} · model ${c.ev}/100. Contrarians are not automatically right — but when high-reliability accounts diverge, understand their reason before following the majority.</div></div>`).join('')}</div>` : '';
  const chips = XT.chips();
  const chipHtml = chips.length ? `<div class="card" style="margin-top:14px"><h2>🃏 Chip strategy intelligence</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${chips.map(c => `<div class="chip-card"><div><b>${H(c.k)}</b></div><div style="font-size:20px;font-weight:800">${c.pct}%</div>
      <div class="muted">${c.auth} accounts · weight ${c.w.toFixed(1)}</div></div>`).join('')}</div>
    <p class="muted" style="margin-top:6px">% of weighted chip discussion (accounts can discuss several chips).</p></div>` : '';
  return `<div class="card"><h2>Elite Voices <span class="muted">— classified posts, newest first · 📊 = data-backed reason</span></h2>
    <div class="hint">Intent matters: <b>action</b> (did it) · <b>lean</b> (leaning) · <b>weak</b> (opinion) · <b>neutral</b> (discussion). Echoes of one original claim are grouped and counted once.</div>
    <div class="voices">${rows || '<p class="hint">Insufficient X data in this window.</p>'}</div></div>
    ${contHtml}${chipHtml}`;
}

// ---------- team ----------
function xTeam() {
  const s = XT.teamSig();
  if (!s.hasTeam) return `<div class="card"><h2>My Team × Elite Trends</h2><p class="hint">Load your team in the My Team tab first, and I'll flag every player you own against what elite managers are doing — plus the buys you're missing.</p></div>`;
  const owned = s.rows.map(x => {
    const col = x.eliteSell ? 'var(--red)' : x.eliteBuy ? 'var(--green)' : 'var(--txt)';
    const advice = x.eliteSell
      ? `<span class="muted">Elite trend <b style="color:var(--red)">selling ${H(x.name)}</b>. Model ${x.ev}/100 — check WHY below; if the sell is fixture/chip-specific (e.g. GW4 red, GW5 green) and your structure differs, holding is rational. Do not sell on vibes.</span>`
      : x.eliteBuy ? `<span class="muted">Elites are <b style="color:var(--green)">buying ${H(x.name)}</b> and you own him — confirm your hold isn't a leftover. Model ${x.ev}/100.</span>`
      : x.cls === 'Avoided' || x.cls.indexOf('fading') >= 0 ? `<span class="muted">You own ${H(x.name)}, who elites are <b style="color:var(--red)">moving away from</b> (${H(x.cls)}). Compare vs your structure before deadline.</span>`
      : `<span class="muted">No elite exit signal on ${H(x.name)} — model ${x.ev}/100. Hold.</span>`;
    return `<div class="v-row"><div><b>${H(x.name)}</b> <span class="team-tag">${H(x.cls)}</span></div>
      <div style="flex:1;min-width:220px">${advice}</div><div style="text-align:right">${x.mom}</div></div>`;
  }).join('');
  const buys = s.buys.length ? `<div class="card" style="margin-top:10px"><h2>You don't own — elites are buying</h2>
    ${s.buys.map(b => `<div class="v-row"><b>${H(b.name)}</b> <span class="team-tag">${b.team} · ${b.pos} · ${H(b.cls)}</span><span class="muted" style="margin-left:auto">net +${b.net.toFixed(1)}w</span></div>`).join('')}
    <p class="hint" style="margin-top:6px">Not a shopping list — cross-check the ⚖️ Compare tab and your budget first.</p></div>` : '';
  return `<div class="card"><h2>My Team × Elite Manager Trends</h2>${owned || '<p class="hint">No elite signal touches your squad in this window.</p>'}</div>${buys}`;
}

// ---------- GW report ----------
function xRepData() {
  const r = XT.agg(); const bs = Object.values(r.byPlayer).filter(b => b.nAuth >= 1);
  const cap = XT.captaincy();
  const flags = XT.hypeFlags();
  const cont = XT.contrarians();
  const tp = XT.template();
  const chips = XT.chips();
  const cwc = chips.find(c => c.k === 'Wildcard');
  const by = (f) => bs.slice().sort((a, b) => f(b) - f(a))[0];
  const mostIn = by(b => b.inW), mostOut = by(b => b.outW);
  const diff = bs.filter(b => b.cls === 'Elite Differential').sort((a, b) => (b.inW - b.outW) - (a.inW - a.outW))[0];
  const fading = bs.filter(b => b.outW > b.inW).sort((a, b) => (b.outW - b.inW) - (a.outW - a.inW))[0];
  const trap = flags.find(f => f.kind === 'trap');
  const lineup = Object.keys(tp).map(p => { const l = tp[p]; return l.length ? `<b>${p}:</b> ${l.map(x => H(x.name) + (x.elite ? ' ✦' : '')).join(', ')}` : `<b>${p}:</b> —`; }).join('<br>');
  const split = cap[1] && cap[0].share - cap[1].share <= 18;
  return { mostIn, mostOut, cap, split, diff, fading, trap, cont, lineup, cwc };
}
function xReport() {
  const R = xRepData();
  if (!R.mostIn) return `<div class="card"><p class="hint">Insufficient X data to build the GW report.</p></div>`;
  const gw = XT.metaInfo().target_gw;
  const items = [
    ['🔥 Biggest transfer trend', R.mostIn ? `<b>${H(R.mostIn.P.name)}</b> (${H(R.mostIn.P.team)}) — elite IN ${R.mostIn.inW.toFixed(1)}w vs OUT ${R.mostIn.outW.toFixed(1)}w · ${XT.fmtM(R.mostIn.momentum)}` : '—'],
    ['🔻 Biggest sell trend', R.mostOut ? `<b>${H(R.mostOut.P.name)}</b> — OUT ${R.mostOut.outW.toFixed(1)}w vs IN ${R.mostOut.inW.toFixed(1)}w` : '—'],
    ['🎯 Captaincy consensus', R.cap[0] ? `<b>${H(R.cap[0].b.P.name)}</b> ${R.cap[0].share}%${R.cap[1] ? ` · runner-up <b>${H(R.cap[1].b.P.name)}</b> ${R.cap[1].share}%` : ''}` : 'Insufficient data'],
    ['⚔️ Captaincy battle', R.cap[1] && R.split ? `<b>${H(R.cap[0].b.P.name)}</b> vs <b>${H(R.cap[1].b.P.name)}</b> — elites are split (${R.cap[0].share}%/${R.cap[1].share}%)` : R.cap[1] ? `<b>${H(R.cap[0].b.P.name)}</b> clear leader (${R.cap[0].share}%)` : '—'],
    ['💎 Biggest emerging differential', R.diff ? `<b>${H(R.diff.P.name)}</b> (${R.diff.P.own}% owned, ${R.diff.P.team})` : '—'],
    ['📉 Biggest fading player', R.fading ? `<b>${H(R.fading.P.name)}</b> (${H(R.fading.cls)})` : '—'],
    ['⚠️ Biggest injury/news concern', 'None in the current window — see team-news freshness rules (news decays in hours, not days).'],
    ['📰 Biggest tactical trend', '3-premium structure + defence consolidation around ARS core — see template below.'],
    ['🚨 Biggest X hype trap', R.trap ? `<b>${H(R.trap.name)}</b> — hype ${R.trap.hy}/100 vs model ${R.trap.ev}/100. High buzz, thin data.` : 'None detected in this window.'],
    ['🧭 Biggest contrarian signal', R.cont.length ? R.cont.slice(0, 2).map(c => `${H(c.name)} (${H(c.dir)} — ${c.accounts.map(H).join(', ')})`).join('<br>') : '—'],
    ['🃏 Wildcard trend', R.cwc ? `${R.cwc.pct}% of chip discussion · ${R.cwc.auth} accounts` : 'Insufficient data'],
    ['🧱 Elite template (discussed)', R.lineup || '—'],
    ['⚖️ Biggest disagreement', R.split ? `Captaincy: ${H(R.cap[0].b.P.name)} vs ${H(R.cap[1].b.P.name)} — see Captaincy section for both camps' arguments.` : 'No major split this GW.'],
    ['🎯 Best X insight for MY team', 'Open the My Team view above: it only acts when a signal touches a player you actually own, and always re-checks the model.'],
  ];
  const lis = items.map(([t, v], i) => `<li><b>${i + 1}. ${t}:</b> ${v}</li>`).join('');
  return `<div class="card"><h2>📋 GW${H(gw)} Elite Manager Intelligence Report</h2>
    <ol class="rep">${lis}</ol>
    <p class="muted" style="margin-top:8px">Every claim above carries its own confidence (Low → High) from independent-signal count, account reliability, recency and agreement. X is a signal, never the decision-maker — the model columns show what the FPL data independently says.</p></div>`;
}

// ---------- natural language ----------
function xAsk(q0) {
  const q = String(q0 || '').toLowerCase();
  const g = XT.agg(); const cap = XT.captaincy();
  if (!g) return null;
  const topN = (arr, n) => arr.slice(0, n).map(b => `<span class="mrow">• <b>${H(b.P.name)}</b> <span class="muted">${b.P.team} · ${b.P.pos}</span> — IN ${b.inW.toFixed(1)}w / OUT ${b.outW.toFixed(1)}w · net <b>${(b.inW - b.outW) >= 0 ? '+' : ''}${(b.inW - b.outW).toFixed(1)}</b> · ${XT.fmtM(b.momentum)}</span>`).join('');
  const sellTop = Object.values(g.byPlayer).filter(b => b.outW > b.inW).sort((a, b) => (b.outW - b.inW) - (a.outW - a.inW));
  const buyTop = Object.values(g.byPlayer).filter(b => b.inW > b.outW).sort((a, b) => (b.inW - b.outW) - (a.inW - a.outW));
  const h = p => H(p.P.name);
  const insuf = () => 'Insufficient X data to answer that in the current window — I won\u2019t invent signals. Check back after more elite accounts post.';
  // 1. top signals
  if (/top 5|top five|signals before/.test(q)) {
    const R = xRepData(); const out = [];
    if (R.mostIn) out.push(`Most bought: ${H(R.mostIn.P.name)} (${R.mostIn.inW.toFixed(1)}w)`);
    if (R.mostOut) out.push(`Most sold: ${H(R.mostOut.P.name)}`);
    if (R.cap[0]) out.push(`Captaincy: ${H(R.cap[0].b.P.name)} ${R.cap[0].share}%${R.split ? ` vs ${H(R.cap[1].b.P.name)} ${R.cap[1].share}%` : ''}`);
    if (R.diff) out.push(`Differential: ${H(R.diff.P.name)} (${R.diff.P.own}% own)`);
    if (R.trap) out.push(`Hype trap: ${H(R.trap.name)}`);
    return out.length ? `Top signals before the GW deadline:<br>${out.map((o, i) => `<span class="mrow">${i + 1}. ${o}</span>`).join('')}` : insuf();
  }
  // 2. head-to-head captaincy
  if (/(haaland|palmer).*(captain|c)/.test(q) || /captain.*(haaland|palmer)/.test(q)) {
    const A = cap.find(c => /haaland/i.test(c.b.P.name)), B = cap.find(c => /palmer/i.test(c.b.P.name));
    const part = (c) => c ? `<b>${H(c.b.P.name)}</b> ${c.share}% — ${c.conf} confirmed captain, ${c.cons} considering` : 'no signals';
    if (!A && !B) return insuf();
    const camps = A && B ? (A.share - B.share <= 18 ? `<br><br>⚠️ They're split. ${H(A.b.P.name)} camp argues: ${XT.campReasons(A.b.P.name).slice(0, 3).join(', ')}. ${H(B.b.P.name)} camp argues: ${XT.campReasons(B.b.P.name).slice(0, 3).join(', ')}.` : `<br><br>${A.share > B.share ? H(A.b.P.name) : H(B.b.P.name)} is the clear consensus.`) : '';
    return `Captaincy right now: ${part(A)} · ${part(B)}.${camps}<br><span class="muted">Model check: Palmer GW4 is ${H(oppTxt('Palmer'))} while Haaland is ${H(oppTxt('Haaland'))} — the fixture data may not match the X consensus; weigh it before copying.</span>`;
  }
  // 3. captaincy in general
  if (/captain/.test(q)) {
    if (!cap.length) return insuf();
    const top = cap.slice(0, 3).map(c => `${H(c.b.P.name)} ${c.share}%`).join(' · ');
    return `Elite captaincy consensus: <b>${top}</b>.${cap[1] && cap[0].share - cap[1].share <= 18 ? ` — note the split between ${H(cap[0].b.P.name)} and ${H(cap[1].b.P.name)} (see Captaincy section).` : ''}`;
  }
  // 4. hype
  if (/hype|trap/.test(q)) {
    const f = XT.hypeFlags().filter(x => x.kind === 'trap');
    return f.length ? `Hype traps (X buzz outrunning the data):<br>${f.map(x => `<span class="mrow">• <b>${H(x.name)}</b> — hype ${x.hy}/100 vs FPL model ${x.ev}/100. ${x.ev < 55 ? 'Model does not support it.' : 'Model is middling — fixture/minutes case is weak.'}</span>`).join('')}` : 'No hype trap detected this window — everything buzzy has data behind it.';
  }
  // 5. talk vs action
  if (/(talk|actually|just talking)/.test(q)) {
    const rows = Object.values(g.byPlayer).filter(b => b.inW > 0 || b.capW > 0).sort((a, b) => (b.nAuth + b.confIn.length) - (a.nAuth + a.confIn.length)).slice(0, 4);
    return rows.length ? `Talk vs action on the movers:<br>${rows.map(b => `<span class="mrow">• <b>${h(b)}</b> — ${b.confIn.length} confirmed IN · ${b.consIn.length} considering · ${Math.max(0, b.nAuth - b.confIn.length - b.consIn.length)} accounts only talking</span>`).join('')}<br><span class="muted">Confirmed decisions (past-tense first-person) outrank "leaning" and "could be good" everywhere in this dashboard.</span>` : insuf();
  }
  // 6. selling
  if (/sell(ing)?|dropping|transfer(ring)? out|moving (on|away)/.test(q)) {
    if (!sellTop.length) return insuf();
    return `Elite managers are selling:<br>${topN(sellTop, 5)}`;
  }
  // 7. buying
  if (/buying|bought|bring(ing)? in|transfer(ring)? in/.test(q) || (/\bwho\b/.test(q) && /\bin\b|bought/.test(q))) {
    if (!buyTop.length) return insuf();
    return `Elite managers are buying (weighted, credibility × accuracy):<br>${topN(buyTop, 5)}<br><span class="muted">Talk vs action: confirmed transfers-in are counted separately from "leaning" — see the Trends table.</span>`;
  }
  // 8. why sell <player>
  if (/why.*(sell|out|drop|moving)/.test(q)) {
    const m = /(?:sell|out|drop|moving).{0,40}?([a-z][a-z.\-\u00c0-\u017f ]{2,28})/.exec(q);
    const name = m ? m[1].trim() : null;
    const cand = name ? Object.values(g.byPlayer).find(b => FOLD2(b.P.name).indexOf(name) >= 0) : null;
    if (!cand) return 'Which player do you mean? e.g. "why are people selling B.Fernandes?"';
    const r = cand.reasons.filter(x => x.src === 'X').map(x => H(x.label)).join(', ');
    return `Why elites sell ${H(cand.P.name)}: X-cited reasons — ${r || 'none in window'}. Data side: ${dataWhy(cand)}.`;
  }
  // 9. differentials
  if (/differential|emerging|under.?own/.test(q)) {
    const d = Object.values(g.byPlayer).filter(b => b.cls === 'Elite Differential').sort((a, b) => b.inW - a.inW);
    return d.length ? `Emerging differentials (low ownership, rising elite interest):<br>${d.slice(0, 4).map(x => `<span class="mrow">• <b>${h(x)}</b> <span class="muted">${x.P.team} · ${x.P.own}% owned</span> — ${XT.fmtM(x.momentum)}</span>`).join('')}<br><span class="muted">⚠️ X is a signal, not proof — check the Compare tab before buying.</span>` : insuf();
  }
  // 10. disagreement / contrarians
  if (/disagr|contrarian|split|who disagree/.test(q)) {
    const cont = XT.contrarians();
    return cont.length ? `Contrarians right now:<br>${cont.slice(0, 4).map(c => `<span class="mrow">• <b>${H(c.name)}</b> — ${H(c.dir)} by ${c.accounts.map(H).join(', ')} (reliability ${c.accounts.map(a => XT.accScore(a)).join('/')}). Why: ${(c.why || []).join(', ')}.</span>`).join('')}<br><span class="muted">Being contrarian is not being right — understand their reason first.</span>` : 'No meaningful elite disagreement this window.';
  }
  // 11. earliest-starting trend
  if (/earliest|first|started (early|before)/.test(q)) {
    const aged = Object.values(g.byPlayer).filter(b => b.nAuth >= 1).sort((a, b) => a.age - b.age).slice(0, 3);
    return aged.length ? `Trends that started earliest (first signal age):<br>${aged.map(b => `<span class="mrow">• <b>${h(b)}</b> — first elite signal ${XT.ageTxt(new Date(Date.now() - b.age * 36e5).toISOString())} ago, ${b.nAuth} voices now</span>`).join('')}` : insuf();
  }
  // 12. momentum
  if (/momentum|last 12|gaining|fastest/.test(q)) {
    const mo = Object.values(g.byPlayer).filter(b => b.momentum.now > 0 && b.nAuth >= 1).sort((a, b) => (b.momentum.pct === 999 ? 1e9 : b.momentum.pct) - (a.momentum.pct === 999 ? 1e9 : a.momentum.pct)).slice(0, 4);
    return mo.length ? `Gaining momentum in the last 12h:<br>${mo.map(b => `<span class="mrow">• <b>${h(b)}</b> — ${XT.fmtM(b.momentum)}</span>`).join('')}` : insuf();
  }
  // 13. template / my team
  if (/my team|template/.test(q)) {
    const s = XT.teamSig();
    const tp = XT.template();
    let out = `Discussed elite template:<br>`;
    Object.keys(tp).forEach(p => { if (tp[p].length) out += `<span class="mrow">• ${p}: ${tp[p].map(x => `${H(x.name)}${x.own >= 45 ? ' (template)' : x.cls === 'Elite Differential' ? ' (diff)' : ''}`).join(', ')}</span>`; });
    out += `<br><span class="muted">"Discussed template" — inferred from signals, not real squads.</span>`;
    if (s.hasTeam) {
      const flagged = s.rows.filter(x => x.eliteSell).map(x => x.name);
      out += `<br><br>Your team: ${flagged.length ? `⚠️ you own ${flagged.join(', ')} whom elites are selling — see the My Team section.` : 'no player you own is on an elite exit list — no forced moves.'}`;
    }
    return out;
  }
  // 14. risks
  if (/risk|worr|before (the )?deadline/.test(q)) {
    const R = xRepData();
    const bits = [];
    if (R.trap) bits.push(`🚨 hype trap: ${H(R.trap.name)} (hype ${R.trap.hy} vs model ${R.trap.ev})`);
    if (R.split) bits.push(`⚖️ captaincy split ${H(R.cap[0].b.P.name)}/${H(R.cap[1].b.P.name)}`);
    const rot = Object.values(g.byPlayer).filter(b => b.reasons.some(x => x.k === 'rot')).map(b => H(b.P.name));
    if (rot.length) bits.push(`🔄 rotation flags on: ${rot.join(', ')}`);
    return bits.length ? `Biggest risks before the deadline:<br>` + bits.map(b => `<span class="mrow">• ${b}</span>`).join('') : 'No acute risk flags in this window.';
  }
  // 15. chips
  if (/chip|wildcard|free hit|bench boost|triple/.test(q)) {
    const c = XT.chips();
    return c.length ? `Chip intelligence:<br>${c.map(x => `<span class="mrow">• ${H(x.k)} — ${x.pct}% of chip discussion · ${x.auth} accounts</span>`).join('')}` : insuf();
  }
  // 16. voices
  if (/voices|who said|posts|accounts/.test(q)) {
    const f = XT.data().xint.posts || [];
    const top = Object.values(g.byPlayer).filter(b => b.nAuth).sort((a, b) => b.nAuth - a.nAuth)[0];
    return f.length ? `${f.length} posts in the window · ${g.indep || 0} independent signals.${top ? ` Most-discussed: ${H(top.P.name)} (${top.nAuth} accounts).` : ''} Open Elite Voices for the classified feed.` : insuf();
  }
  return null;
}
function oppTxt(name) { const r = XT.agg().byPlayer[name]; if (!r) return '?'; const P = r.P; const f = (P.next3 || [])[0]; return f ? `${f.opp} (${f.ha})` : '?'; }
function dataWhy(b) {
  const parts = [];
  if (b.evidence >= 70) parts.push(`model ${b.evidence}/100 (strong)`);
  if (b.evidence <= 45) parts.push(`model ${b.evidence}/100 (weak)`);
  return parts.join(' · ') || `model ${b.evidence || '?'}/100`;
}
const FOLD2 = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function Dx() { return (typeof DATA !== 'undefined' && DATA.xint) ? DATA.xint.posts : []; }
function ageTxt(iso) { return XT.ageTxt(iso); }

// ---------- tab entry ----------
function renderXINT() {
  const safe = (fn, id) => { try { fn(); } catch (e) { console.error('[XINT]', id, e); const el = $(id); if (el) el.innerHTML = '<div class="card"><p class="hint">⚠️ ' + H(e.message || e) + '</p></div>'; } };
  safe(() => { $('#xintDq').innerHTML = xDq(); }, '#xintDq');
  safe(() => { $('#xintPulse').innerHTML = xPulse(); }, '#xintPulse');
  safe(() => { $('#xintTrends').innerHTML = xTrends(); }, '#xintTrends');
  safe(() => { $('#xintPlayers').innerHTML = xPlayers(); }, '#xintPlayers');
  safe(() => { $('#xintCap').innerHTML = xCaptaincy(); }, '#xintCap');
  safe(() => { $('#xintVoices').innerHTML = xVoices(); }, '#xintVoices');
  safe(() => { $('#xintTeam').innerHTML = xTeam(); }, '#xintTeam');
  safe(() => { $('#xintReport').innerHTML = xReport(); }, '#xintReport');
}

// tabs
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'wildcard') renderWildcard();
  if (t.dataset.tab === 'xint') renderXINT();
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
// X Intelligence desk (NL)
function xintAnswer(q) {
  const out = $('#xintOut');
  try {
    const ans = (typeof xAsk === 'function' && DATA.xint && (DATA.xint.posts || []).length) ? xAsk(q) : null;
    if (ans) { out.innerHTML = ans; out.classList.add('show'); }
    else { out.innerHTML = 'That one needs the ⚖️ Compare / My Team tools (or a player name). X-desk questions I answer: buying/selling, captaincy consensus, emerging differentials, contrarians, hype traps, momentum in the last 12h, talk-vs-action, chips, top-5 signals and my-team-vs-template.'; out.classList.add('show'); }
  } catch (e) { out.innerHTML = '⚠️ ' + H(e.message || e); out.classList.add('show'); }
}
(function wireXINT() {
  const q = $('#xintQ'), btn = $('#xintAsk');
  if (!q || !btn) return;
  const ask = () => { const v = q.value.trim(); if (v) { xintAnswer(v); q.value = ''; } };
  btn.onclick = ask;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  document.querySelectorAll('#xintQs .chip').forEach(c => { c.onclick = () => xintAnswer(c.textContent); });
})();
