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
