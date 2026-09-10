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

