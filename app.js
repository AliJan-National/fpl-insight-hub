const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DATA = {};

async function load() {
  const names = ['meta', 'league', 'results', 'players', 'radar', 'fixtures', 'news', 'captains', 'prices', 'fplmeta', 'ticker', 'teams', 'history'];
  const res = await Promise.all(names.map(n => fetch(`api/${n}.json`).then(r => r.json())));
  names.forEach((n, i) => DATA[n] = res[i]);
  renderAll();
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
    p.ep_next = p.ep_next ?? p.ep ?? 0; // official expected points, normalised field name
    const a = (window.TF[p.team] || {}).afx || [];
    (p.next3 || []).forEach((f, i) => {
      if (a[i] != null) { f.adjv = a[i]; f.afdr = Math.max(1, Math.min(5, Math.round(a[i]))); }
    });
  });
  window.adjAvg3 = p => { const v = (p.next3 || []).map(f => f.adjv ?? f.fdr); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 3; };
  window.ownForm = p => (window.TF[p.team] || {}).tf ?? 1;
  window.formRank = p => (window.TF[p.team] || {}).rank || 10;
  window.NEXT_BY_CODE = (DATA.fplmeta && DATA.fplmeta.fixtures_by_code) || window.NEXT3_BY_CODE;
  renderLeague(); renderTopScorers(); renderResults();
  renderRadar(); renderPlayers(); renderFixtures(); renderNews();
  $('#playerNames').innerHTML = DATA.players.map(p => `<option value="${esc(p.name)}">`).join('');
  $('#cmpGo').onclick = renderCompare;
  $('#planSolve').onclick = solvePlan;
  renderCaptains(); renderPrices();
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
  Object.entries(NEXT).forEach(([code, arr]) => {
    const t = teamById[code]; const a = (window.TF[t && t.short] || {}).afx || [];
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
const pScore = (p) => (p.form || 0) * 1.2 + (p.ep_next || 0) * 1.5 + (3 - adjAvg3(p)) * 1.5 + ownForm(p) * 1.5 + (p.pos === 'DEF' ? Math.min(2, (p.cbit || 0) * 0.05) : 0);
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
  $('#wcMeta').textContent = `· GW${DATA.fplmeta.current_gw + 1} edition · spend £${WC.spent.toFixed(1)}m of £100m · built on the same performance model as the Fixtures ticker`;
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
  const caps = all.map(p => ({ p, c: (p.ep_next || 0) * (fdrM[((p.next3 || [])[0] || {}).afdr ?? ((p.next3 || [])[0] || {}).fdr ?? 3] || 1) * (0.9 + 0.1 * ownForm(p)) })).sort((a, b) => b.c - a.c);
  $('#wcCaptain').innerHTML = caps.slice(0, 2).map((x, i) => `
    <div class="sig-card"><div class="rank">${i ? 'V' : 'C'}</div>
      <div class="sig-info"><div class="sig-name">${esc(x.p.name)} ${posBadge(x.p.pos)} <span class="team-tag">${x.p.team} · ${((x.p.next3 || [])[0] || {}).opp || '—'}(${((x.p.next3 || [])[0] || {}).ha || '?'})</span></div>
      <div class="sig-meta">ep ${x.p.ep_next} · adj FDR ${((x.p.next3 || [])[0] || {}).afdr ?? ((x.p.next3 || [])[0] || {}).fdr ?? 3} · team #${formRank(x.p)}</div></div>
      <div class="sig-pts"><div class="pts">${x.c.toFixed(1)}</div></div></div>`).join('');
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
function findPlayer(q) {
  const Q = q.toLowerCase();
  let best = null;
  for (const p of DATA.players) {
    const words = p.name.toLowerCase().split(/[\s.]+/);
    const hit = Q.includes(p.name.toLowerCase()) || words.some(w => w.length >= 4 && Q.includes(w));
    if (hit && (!best || p.name.length > best.name.length)) best = p;
  }
  return best;
}
function askAI(q) {
  const Q = q.toLowerCase();
  const ctx = window.TEAMCTX;
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
// per-GW model projection: official ep_next × form-adjusted FDR (shared model) × H/A × minutes probability
const projP = (p, i) => {
  const t = window.TF[p.team] || {};
  const a = (t.afx || [3, 3, 3, 3, 3, 3, 3])[i] ?? 3;
  const f = (p.next3 || [])[i] || null;
  const ha = f ? f.ha : null;
  const minProb = p.status !== 'a' ? 0.3 : Math.min(1, 0.5 + 0.5 * ((p.mins || 0) / 270));
  return (p.ep_next || 0) * (FM[Math.max(1, Math.min(5, Math.round(a)))] || 1) * (ha === 'H' ? 1.06 : ha === 'A' ? 0.94 : 1) * minProb;
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
  const ctx = window.TEAMCTX;
  if (!ctx) {
    $('#planOut').innerHTML = '<div class="card"><p class="hint">Load your team in <b>My Team</b> first — the solver plans <b>your</b> squad, bank and free transfers.</p></div>';
    $('#chipOpt').innerHTML = '';
    return;
  }
  const H = +$('#planHorizon').value;
  let squad = ctx.squad.map(s => DATA.players.find(p => p.id === s.r.element)).filter(Boolean);
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
  $('#planOut').innerHTML = `<div class="card"><h2>🧾 Optimal ${H}-GW plan · projected ≈ ${tot.toFixed(1)} pts</h2>
    <table class="data"><tr><th>GW</th><th>Move</th><th>Captain</th><th class="num">Proj XI+cap</th><th>FT left</th></tr>
    ${rows.map(r => `<tr><td><b>GW${r.gw}</b></td>
      <td>${r.act ? `<span class="down">− ${esc(r.act.out.name)}</span> → <span class="up">+ ${esc(r.act.inn.name)}</span>${r.hit ? ' <b class="down">(hit −4)</b>' : ''}</td>` : 'Roll (save FT)'}</td>
      <td><b>${r.cap ? esc(r.cap.name) : '—'}</b></td><td class="num">${r.proj.toFixed(1)}</td><td class="num">${r.ft}</td></tr>`).join('')}
    </table>
    <p class="muted">Projections use the shared form-adjusted model (ep × adj FDR × home/away × minutes). Re-solve after every deadline — plans are dynamic, not promises.</p></div>`;
  chipOptimizer(squad, H);
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

function renderCompare() {
  const pick = id => findPlayer(($('#' + id).value || '').toLowerCase());
  const ps = [pick('cmpA'), pick('cmpB'), pick('cmpC')].filter(Boolean);
  const uniq = [...new Map(ps.map(p => [p.id, p])).values()];
  if (uniq.length < 2) { $('#cmpOut').innerHTML = '<p class="hint">Type two player names (autocomplete helps) and hit Compare.</p>'; return; }
  const H = 5;
  $('#cmpOut').innerHTML = uniq.map(p => {
    const proj = []; for (let i = 0; i < H; i++) proj.push(projP(p, i));
    const tot = proj.reduce((a, b) => a + b, 0);
    const max = Math.max(...proj, 1);
    const bars = proj.map((v, i) => `<div style="flex:1;text-align:center"><div style="height:${Math.round(34 * v / max)}px;background:linear-gradient(180deg,#00ff85,#0a8f52);border-radius:4px 4px 0 0" title="GW${DATA.fplmeta.current_gw + 1 + i}: ${v.toFixed(1)}"></div><div class="tk-opp">${(p.next3 || [])[i] ? (p.next3[i].opp + (p.next3[i].ha)) : 'GW' + (DATA.fplmeta.current_gw + 1 + i)}</div></div>`).join('');
    const h = (DATA.history || {})[p.id] || [];
    return `<div class="ml-rival" style="min-width:240px">
      <h4>${esc(p.name)} ${posBadge(p.pos)} <span class="muted">${p.team} · £${p.cost}m</span></h4>
      <div class="gapline">${p.pts} pts · form ${p.form} · ep ${p.ep_next} · xG ${p.xg} (${p.xg_diff >= 0 ? '+' : ''}${(p.xg_diff || 0).toFixed(1)}) · ${p.own}% own · team form #${formRank(p)}</div>
      ${sparkSVG(p.id, 220, 40)}
      <div style="display:flex;gap:3px;align-items:flex-end;height:52px;margin-top:8px">${bars}</div>
      <div class="gapline" style="margin-top:6px">Next-5 projection: <b>${tot.toFixed(1)}</b> pts · adj FDR ${adjAvg3(p).toFixed(1)}</div>
      ${h.length ? `<div class="tk-opp">last GWs: ${h.map(r => r[1] + 'pts').join(' · ')}</div>` : ''}
    </div>`;
  }).join('') + (() => {
    const sorted = uniq.slice().sort((a, b) => { let sa = 0, sb = 0; for (let i = 0; i < H; i++) { sa += projP(a, i); sb += projP(b, i); } return sb - sa; });
    let sa = 0, sb = 0; for (let i = 0; i < H; i++) { sa += projP(sorted[0], i); sb += projP(sorted[1], i); }
    return `<div class="card" style="grid-column:1/-1"><p>🤖 Model edge over next 5: <b>${esc(sorted[0].name)}</b> by <b>+${(sa - sb).toFixed(1)}</b> projected pts${ML.ready ? ` — and ${ML.ownCount(sorted[0])}/${ML.n} of your rivals own him vs ${ML.ownCount(sorted[1])}/${ML.n} for ${esc(sorted[1].name)}` : ''}.</p></div>`;
  })();
}

// tabs
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'wildcard') renderWildcard();
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
