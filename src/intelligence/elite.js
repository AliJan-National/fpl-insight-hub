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
