// ============ 🃏 FREE HIT LAB (one-week squad optimizer + assistant) ============
// Free Hit = a completely new 15-man squad for ONE gameweek only. This builds the
// best legal FH squad for each of the next 3 GWs on the SAME production forecast
// spine (projP / minutesOf), so you can see which week deserves the chip.
// Constraints honoured: 15 players, 2 GK / 5 DEF / 5 MID / 3 FWD, max 3 per club,
// budget = your squad value + bank when your team is loaded (else £100m).
// Every number is a labelled model estimate. Pure core (fhCandidates / fhSquadFor /
// freeHitPlan / freeHitAnswer) is deterministic + regression-tested; rendering is
// guarded so a failure can never take the tab (or the app) down.
const FH_MEMO = {};
const FH_FORMS = [[5,4,1],[5,3,2],[4,5,1],[4,4,2],[4,3,3],[3,5,2],[3,4,3]];
function fhBudget() {
  try { const c = window.TEAMCTX; if (c && c.value != null) return Math.max(100, Math.min(110, c.value + (c.bank || 0))); } catch (e) {}
  return 100;
}
function fhTeamIds() {
  try { const c = window.TEAMCTX; if (!c || !c.squad) return new Set();
    return new Set((c.squad || []).map(r => r && (r.p ? r.p.id : r.id)).filter(x => x != null));
  } catch (e) { return new Set(); }
}
function fhCandidates(i) {
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  (DATA.players || []).forEach(p => {
    if (!p || !p.name || p.cost == null) return;
    const f = (p.next3 || [])[i]; if (!f || !f.opp) return;
    const ok = p.status === 'a' || (p.status === 'd' && (p.chance_next == null || p.chance_next >= 50));
    if (!ok) return;
    let xp = 0; try { xp = Math.max(0, projP(p, i)); } catch (e) { xp = 0; }
    let em = 60; try { em = minutesOf(p).expMin; } catch (e) {}
    if (xp < 0.5 || em < 25) return;
    byPos[p.pos].push({ p, xp: Math.round(xp * 100) / 100, cost: p.cost, f });
  });
  Object.keys(byPos).forEach(k => byPos[k].sort((a, b) => b.xp - a.xp));
  return byPos;
}
function fhSquadFor(i, budget) {
  const byPos = fhCandidates(i);
  const gw = ((DATA.players.find(p => p.next3 && p.next3[i]) || {}).next3[i] || {}).gw || ((DATA.fplmeta || {}).next_gw || 0) + i;
  const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  // ---- bench: the cheapest playable player at each of the four positions ----
  const bench = [], left = Object.assign({}, QUOTA);
  ['GK', 'DEF', 'MID', 'FWD'].forEach(pos => {
    const cheap = byPos[pos].slice().sort((a, b) => a.cost - b.cost || b.xp - a.xp)[0];
    if (cheap) { bench.push(cheap); left[pos]--; }
  });
  // ---- XI: Lagrangian greedy on (xp - lambda*cost), then hill-climbing swaps ----
  const clubCount = {}; bench.forEach(r => clubCount[r.p.team] = (clubCount[r.p.team] || 0) + 1);
  let spent = bench.reduce((s, r) => s + r.cost, 0);
  const picked = { GK: [], DEF: [], MID: [], FWD: [] };
  const pick = (r) => { picked[r.p.pos].push(r); spent += r.cost; clubCount[r.p.team] = (clubCount[r.p.team] || 0) + 1; };
  const drop = (r) => { picked[r.p.pos] = picked[r.p.pos].filter(x => x !== r); spent -= r.cost; clubCount[r.p.team]--; };
  const feas = (r) => (clubCount[r.p.team] || 0) < 3;
  const B = budget - spent;
  let lam = 0, lo = 0, hi = 4;
  const tryBuild = (l) => {  // returns {ok, picks, cost} without mutating state
    // ONE club map shared across ALL positions (bench counts too) — the 3-per-club
    // rule is a squad constraint, not a per-position one.
    const cc = {}; bench.forEach(r => cc[r.p.team] = (cc[r.p.team] || 0) + 1);
    const picks = []; let cost = 0;
    Object.keys(QUOTA).forEach(pos => {
      const need = left[pos]; if (need <= 0) return;
      let taken = 0;
      const pool = byPos[pos].slice().sort((a, b) => (b.xp - l * b.cost) - (a.xp - l * a.cost));
      for (const r of pool) { if (taken >= need) break; if ((cc[r.p.team] || 0) >= 3 || picks.includes(r)) continue; cc[r.p.team] = (cc[r.p.team] || 0) + 1; picks.push(r); cost += r.cost; taken++; }
      if (taken < need) for (const r of byPos[pos]) { if (taken >= need) break; if (picks.includes(r) || (cc[r.p.team] || 0) >= 3) continue; cc[r.p.team] = (cc[r.p.team] || 0) + 1; picks.push(r); cost += r.cost; taken++; }
    });
    return { ok: picks.filter(r => r.p.pos === 'GK').length === 1 && picks.length === 11 && cost <= B + 1e-9, picks, cost };
  };
  for (let it = 0; it < 40; it++) { lam = (lo + hi) / 2; const t = tryBuild(lam); if (t.ok) hi = lam; else lo = lam; }
  let build = tryBuild(hi);
  if (!build.ok) build = tryBuild(4);           // desperate: cheapest-ish anyway
  build.picks.forEach(r => pick(r));
  // ---- hill-climb: single best affordable upgrade until none left ----
  for (let guard = 0; guard < 200; guard++) {
    let bestSwap = null;
    Object.keys(QUOTA).forEach(pos => {
      picked[pos].forEach(out => {
        for (const cand of byPos[pos]) {
          if (picked[pos].includes(cand) || bench.includes(cand)) continue;
          if (cand.xp <= out.xp) break;         // pool sorted by xp desc — stop early
          if (!feas(cand)) continue;
          if (spent - out.cost + cand.cost > budget + 1e-9) continue;
          const gain = cand.xp - out.xp;
          if (!bestSwap || gain > bestSwap.gain) bestSwap = { out, cand, gain };
        }
      });
    });
    if (!bestSwap) break;
    drop(bestSwap.out); pick(bestSwap.cand);
  }
  // ---- assemble + best XI formation ----
  const squad = bench.concat([].concat(...Object.keys(picked).map(k => picked[k])));
  if (squad.length !== 15) return { gw, error: 'not enough playable candidates (' + squad.length + '/15)' };
  let bestForm = null;
  FH_FORMS.forEach(([d, m, f]) => {
    if (picked.DEF.length < d || picked.MID.length < m || picked.FWD.length < f) return;
    const gk = picked.GK[0];
    const dd = picked.DEF.slice().sort((a, b) => b.xp - a.xp).slice(0, d);
    const mm = picked.MID.slice().sort((a, b) => b.xp - a.xp).slice(0, m);
    const ff = picked.FWD.slice().sort((a, b) => b.xp - a.xp).slice(0, f);
    const tot = gk.xp + dd.concat(mm, ff).reduce((s, r) => s + r.xp, 0);
    if (!bestForm || tot > bestForm.tot) bestForm = { form: [d, m, f], tot, starters: [gk].concat(dd, mm, ff) };
  });
  if (!bestForm) return { gw, error: 'no legal formation' };
  const starters = bestForm.starters, subs = squad.filter(r => !starters.includes(r));
  const captain = starters.slice().sort((a, b) => b.xp - a.xp)[0];
  const fhScore = Math.round((bestForm.tot + captain.xp) * 10) / 10;
  const myIds = fhTeamIds();
  const rows = squad.slice().sort((a, b) => ({ GK: 0, DEF: 1, MID: 2, FWD: 3 })[a.p.pos] - ({ GK: 0, DEF: 1, MID: 2, FWD: 3 })[b.p.pos] || b.xp - a.xp);
  return {
    gw, budget: Math.round(budget * 10) / 10, spent: Math.round(spent * 10) / 10,
    squad: rows, starters, subs, bench, formation: bestForm.form.join('-'),
    captain, fhScore, overlap: rows.filter(r => myIds.has(r.p.id)).length,
    headline: rows.filter(r => r !== captain).sort((a, b) => b.xp - a.xp).slice(0, 3),
  };
}
function freeHitPlan() {
  if (FH_MEMO.plan) return FH_MEMO.plan;
  const budget = fhBudget();
  const gws = [0, 1, 2].map(i => { try { return fhSquadFor(i, budget); } catch (e) { return { gw: i, error: e.message }; } });
  const ok = gws.filter(g => !g.error);
  let best = null;
  ok.forEach(g => { if (!best || g.fhScore > best.fhScore) best = g; });
  const why = best ? ok.filter(g => g !== best).map(g => '+' + (best.fhScore - g.fhScore).toFixed(1) + ' xP over GW' + g.gw).join(' and ') : '';
  const used = (() => { try { return (window.TEAMCTX.usedChips || []).indexOf('freehit') >= 0; } catch (e) { return false; } })();
  FH_MEMO.plan = { budget, gws, best, why, chipUsed: used, n: ok.length };
  return FH_MEMO.plan;
}
// ---- the assistant: deterministic, grounded in the computed plan, never invents maths ----
function freeHitAnswer(q0) {
  const q = String(q0 || '').toLowerCase();
  const P = freeHitPlan();
  const nm = r => esc(r.p.name) + ' (' + r.p.pos + ', ' + esc(r.p.team) + ', £' + r.p.cost + 'm, ' + r.xp.toFixed(1) + ' xP vs ' + esc(r.f.opp) + (r.f.ha === 'H' ? '(H)' : '(A)') + ')';
  if (!P.best) return 'Not enough player data to build Free Hit squads yet.';
  if (/which|when|best week|what week|week should|recommend/.test(q)) {
    const others = P.gws.filter(g => !g.error && g !== P.best).map(g => 'GW' + g.gw + ' ' + g.fhScore.toFixed(1) + ' xP').join(' · ');
    return '<b>GW' + P.best.gw + ' is the strongest Free Hit week: ' + P.best.fhScore.toFixed(1) + ' xP</b> (' + others + '). '
      + (P.why ? 'That is ' + P.why + '. ' : '')
      + 'Captain: <b>' + esc(P.best.captain.p.name) + '</b> (' + P.best.captain.xp.toFixed(1) + ' xP). Formation ' + P.best.formation + ', £' + P.best.spent.toFixed(1) + 'm of £' + P.budget.toFixed(1) + 'm. '
      + (P.chipUsed ? '⚠️ Note: your loaded team shows Free Hit as already played — this is the analysis, not a live chip.' : 'All figures are model estimates from the same forecast spine as the rest of the app.');
  }
  if (/captain/.test(q)) {
    return '<b>Free Hit captains by week:</b><br>' + P.gws.filter(g => !g.error).map(g => 'GW' + g.gw + ': <b>' + esc(g.captain.p.name) + '</b> — ' + g.captain.xp.toFixed(1) + ' xP vs ' + esc(g.captain.f.opp) + (g.captain.f.ha === 'H' ? ' (H)' : ' (A)')).join('<br>') + '<br><span class="muted">Highest projected starter that week (model estimate).</span>';
  }
  if (/team|squad|show|players|line ?up|xi/.test(q)) {
    const g = P.gws.filter(x => !x.error).find(x => x === P.best) || P.best;
    const list = g.squad.map(r => (g.starters.includes(r) ? '' : '<span class="muted">(bench)</span> ') + (r === g.captain ? '★ ' : '') + esc(r.p.name) + ' ' + r.p.pos + ' £' + r.p.cost + 'm — ' + r.xp.toFixed(1)).join('<br>');
    return '<b>Free Hit squad, GW' + g.gw + ' (' + g.fhScore.toFixed(1) + ' xP, formation ' + g.formation + ', £' + g.spent.toFixed(1) + 'm):</b><br>' + list + '<br><span class="muted">★ = captain (x2). All model estimates.</span>';
  }
  if (/bench/.test(q)) {
    const g = P.best;
    return '<b>Bench (GW' + g.gw + '):</b><br>' + g.bench.map(r => esc(r.p.name) + ' £' + r.p.cost + 'm (' + r.xp.toFixed(1) + ' xP)').join('<br>') + '<br><span class="muted">Cheapest playable options — a one-week squad spends its money on the XI; the bench is pure insurance.</span>';
  }
  if (/budget|cost|money|price|spent/.test(q)) {
    const g = P.best;
    const priciest = g.squad.slice().sort((a, b) => b.cost - a.cost)[0];
    return 'Budget £' + P.budget.toFixed(1) + 'm' + (window.TEAMCTX ? ' (your squad value + bank)' : ' (standard — load your team in My Team to use your real value)') + '. GW' + g.gw + ' spends £' + g.spent.toFixed(1) + 'm, leaving £' + (g.budget - g.spent).toFixed(1) + 'm. Priciest: ' + esc(priciest.p.name) + ' (£' + priciest.cost + 'm). Bench costs £' + g.bench.reduce((s, r) => s + r.cost, 0).toFixed(1) + 'm of it.';
  }
  if (/why|reason|explain/.test(q)) {
    const g = P.best;
    return 'GW' + g.gw + ' wins on <b>' + g.fhScore.toFixed(1) + ' xP</b>. ' + (P.why || '') + ' Headline picks: ' + g.headline.map(r => esc(r.p.name) + ' (' + r.xp.toFixed(1) + ' vs ' + esc(r.f.opp) + ')').join(', ') + '. Captain ' + esc(g.captain.p.name) + ' doubles ' + g.captain.xp.toFixed(1) + '. ' + (g.overlap ? 'It keeps ' + g.overlap + ' of your current players (no wasted value).' : 'It is a full tear-up of your current XV — that is what Free Hit is for.');
  }
  if (/risk|injur|doubt|flag/.test(q)) {
    const risky = [];
    P.gws.filter(g => !g.error).forEach(g => g.squad.forEach(r => { if (r.p.status === 'd' || (r.p.chance_next != null && r.p.chance_next < 100)) risky.push('GW' + g.gw + ' ' + r.p.name); }));
    return risky.length ? 'Doubts carried into squads (official status, monitored): ' + risky.map(esc).join(', ') + '. Injured/suspended players are excluded entirely.' : 'No injury doubts in any of the three squads — injured and suspended players are excluded before optimization. Only official 50%+ doubts can enter.';
  }
  if (/overlap|current|my team|mine/.test(q)) {
    return P.gws.filter(g => !g.error).map(g => 'GW' + g.gw + ': ' + g.overlap + '/15 overlap with your current squad').join('<br>') + (window.TEAMCTX ? '' : '<br><span class="muted">Load your team in My Team for overlap tracking.</span>');
  }
  return 'I answer from the real Free Hit plan: try <b>"which week"</b>, <b>"show the team"</b>, <b>"captain?"</b>, <b>"bench"</b>, <b>"budget"</b>, <b>"why GW' + P.best.gw + '"</b>, <b>"risks"</b> or <b>"overlap"</b>. Everything I say comes from the same forecast spine as the app — no invented numbers.';
}
// ---- rendering (guarded; failures can never break the tab) ----
function fhRow(r, g) {
  const st = g.starters.includes(r), cap = r === g.captain;
  return '<tr' + (st ? '' : ' style="opacity:.62"') + '><td>' + posBadge(r.p.pos) + '</td><td><b>' + esc(r.p.name) + '</b>' + (cap ? ' <span class="mp-chip ok">C ×2</span>' : '') + (st ? '' : ' <span class="mp-chip muted">bench</span>') + (r.p.status === 'd' ? ' <span class="mp-chip warn">doubt</span>' : '') + '</td><td>' + esc(r.p.team) + '</td><td class="num">£' + r.p.cost + 'm</td><td class="num"><b>' + r.xp.toFixed(1) + '</b></td><td>' + esc(r.f.opp) + ' <span class="fdr f' + (r.f.fdr || 3) + '">' + (r.f.fdr || 3) + '</span></td></tr>';
}
function renderFreeHit() {
  const host = $('#fhBody'); if (!host) return;
  try {
    const P = freeHitPlan();
    if (!P.best) { host.innerHTML = '<p class="hint">Not enough player data to build Free Hit squads yet.</p>'; return; }
    const cards = P.gws.map(g => {
      if (g.error) return '<div class="card"><h2>GW' + g.gw + '</h2><p class="hint">' + esc(g.error) + '</p></div>';
      const isBest = g === P.best;
      return '<div class="card"' + (isBest ? ' style="border-color:rgba(0,255,133,.5)"' : '') + '><h2>' + (isBest ? '⭐ ' : '') + 'GW' + g.gw + ' <span class="muted">— ' + g.fhScore.toFixed(1) + ' xP</span>' + (isBest ? ' <span class="mp-chip ok">BEST WEEK</span>' : '') + '</h2>'
        + '<p class="hint" style="margin:0 0 8px">Formation ' + g.formation + ' · £' + g.spent.toFixed(1) + 'm/' + g.budget.toFixed(1) + 'm · captain <b>' + esc(g.captain.p.name) + '</b> (' + g.captain.xp.toFixed(1) + '×2)' + (g.overlap ? ' · ' + g.overlap + '/15 of your current squad' : '') + '</p>'
        + '<table class="data compact"><tr><th></th><th>Player</th><th>Team</th><th class="num">£</th><th class="num">xP</th><th>Fix</th></tr>' + g.squad.map(r => fhRow(r, g)).join('') + '</table></div>';
    }).join('');
    const used = P.chipUsed ? '<p class="hint" style="color:var(--amber)">⚠️ Your loaded team shows Free Hit as <b>already played</b> — this is the analysis; the chip itself is gone this season.</p>' : '';
    host.innerHTML = used
      + '<div class="card"><h2>🃏 Free Hit — which week?</h2><p class="hint" style="margin:0 0 10px">The best legal 15-man squad for each of the next 3 gameweeks, built on the same forecast spine as the whole app (projP + minutes model). Pick the week with the highest total — that is where the chip pays most.</p>'
      + '<div class="grid3" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">' + P.gws.filter(g => !g.error).map(g => '<div class="card" style="margin:0;text-align:center' + (g === P.best ? ';border-color:rgba(0,255,133,.5)' : '') + '"><div style="font-size:12px" class="muted">GW' + g.gw + '</div><div style="font-size:26px;font-weight:800;color:' + (g === P.best ? 'var(--green)' : 'var(--txt)') + '">' + g.fhScore.toFixed(1) + '</div><div class="muted" style="font-size:11px">xP (captain ×2 included)</div></div>').join('') + '</div>'
      + '<p class="hint" style="margin:10px 0 0"><b>Verdict: GW' + P.best.gw + '</b> — ' + esc(P.why || '') + '. Captain ' + esc(P.best.captain.p.name) + '. ' + (P.budget > 100 ? 'Budget = your squad value (£' + P.budget.toFixed(1) + 'm).' : 'Standard £100m budget — load your team for your real value.') + ' All model estimates.</p></div>'
      + '<div class="grid2">' + cards + '</div>';
  } catch (e) { host.innerHTML = '<p class="hint">Free Hit Lab unavailable: ' + esc(e.message) + '</p>'; }
}
(function wireFreeHit() {
  // Pure wiring, cosmetic only — must never throw in a browser OR any test harness.
  try {
    if (typeof document === 'undefined' || typeof $ !== 'function') return;
    const q = $('#fhQ'), btn = $('#fhAsk'), out = $('#fhOut');
    if (!q || !btn || !out) return;
    const ask = () => { const v = q.value.trim(); if (!v) return; out.innerHTML = freeHitAnswer(v); out.classList.add('show'); q.value = ''; };
    btn.onclick = ask;
    if (typeof q.addEventListener === 'function') q.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
    document.querySelectorAll('#fhQs .chip').forEach(c => { c.onclick = () => { out.innerHTML = freeHitAnswer(c.textContent); out.classList.add('show'); }; });
  } catch (e) { /* no DOM / partial stub — tab still renders, buttons just won't wire here */ }
})();

