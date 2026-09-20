# v49 — Phase 5a: the channel model (pitch-zone intelligence)

**The user's request (2026-09-17):** Twitter-style pitch-zone analysis — where each team
attacks and defends (left/centre/right) — to answer questions like "should I bring in a
right winger or left winger?" 

## Discovery

The approved data repo (FPL-Core-Insights) carries `By Gameweek/GW*/shots.csv`: **every
real shot with pitch coordinates** (`start_x`, `start_y`), xG, situation, body part.
1,087 shots for GW1-4 — the open-data equivalent of what those pitch-map graphics are
built from. Coordinates are attacking-view normalised (verified: both teams' shots are
goal-relative).

## Validation (before trusting the axis)

| player | avg shot y (50 = centre) | verdict |
|---|---|---|
| Mbeumo | 62.8 | RIGHT wing ✓ |
| Haaland | 47.7 | central striker ✓ |
| Saka | 55.7 | right-sided ✓ |
| João Pedro | 49.0 | central ✓ |

Channels: **L = y < 40, C = 40-60, R = > 60** (half-space geometry, not naive thirds).

## The model (`src/models/channels.js` + `api/channels.json`)

- **Team attack/defence profiles**: xG-weighted shares by channel, shrunk to the league
  profile with K=2.5 xG (~35% prior weight at GW4, fading as the season grows). xG-
  weighting matters: Nottingham Forest concede 26% of SHOTS down one flank but only 8%
  of xG from there — low-quality shots. The model prices quality, not volume.
- **Player lateral positions**: own shot cloud; a side is classified at n>=4 shots and
  |mean-50|>=5 (178 players so far).
- **channelEdge(p, gw)**: the mismatch — a left/right-sided attacker vs a defence
  conceding >=1.2x league from that channel. Suggested multiplier clamped to [0.92, 1.10]
  pending backtest. Early real reads: Liverpool leak the LEFT channel (1.57x league),
  Arsenal concede 1.57x down the RIGHT, Fulham generate 1.83x of league from the LEFT.
- **Orientation rule** (documented everywhere): channels are in ATTACKING view — the
  attack's left channel is the defence's right side.

## Where it surfaces

- **Real Strength tab**: a pitch-map card — all 20 teams, attack xG shares (green bars),
  concession shares with >=1.2x leaks in red, plus the next GW's biggest flank mismatches.
- **Scout / H2H cards**: a 🧭 flank-matchup line when the mismatch is material (>=1.2x or
  <=0.8x — no noise otherwise).
- **Assistant**: "which wing should I pick?", "which channel does Mbeumo play?" — grounded
  answers with the real ratios.

## Status: BESIDE production (the audit rule)

Analysis, cards and assistant only — **not in projP**. It joins the xP spine only after
the Phase 8 backtest matrix proves it beats the channel-blind baseline on the frozen
snapshots. Every surface says so.

## Pipeline notes

- `build_data.py` builds `api/channels.json` (needs `By Gameweek/GW*/shots.csv` from the
  CSV clone — the automated workflow gets it automatically; dev needs the clone, refreshed
  via `refresh.sh`). Team-name slugs in match_ids use full names vs teams.csv short names
  — aliased in the builder, with a loud warning if any slug ever goes unmapped.
- The workspace keeps no CSV clone between releases (2.3MB minimal fetch was used for this
  build, then deleted — re-fetch or `refresh.sh` when needed).
- Future snapshots freeze `channels.json` automatically (freeze copies all api/*.json).

## Test state
`channels_test.js` (20 checks: shape, validation trio, mismatch math + clamps, guards,
rendering, degrade, determinism). Dev battery: **894 PASS / 0 FAIL across 31 suites**.
