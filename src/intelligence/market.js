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

