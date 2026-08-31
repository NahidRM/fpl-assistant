# FPL Assistant — Design Spec

**Date:** 2026-08-29
**Revised:** 2026-08-30 after a critical review (see §12)
**Status:** Approved pending final review
**Supersedes:** the original Build Brief, where they differ (differences noted inline)

## 1. Purpose

A personal, $0/month web app that ranks Fantasy Premier League players by value
and predicted performance. General leaderboard, not tied to any one squad.
Static site plus a manually-triggered data pipeline. No backend, no database,
no paid APIs.

## 2. Context that shaped this design

Verified against the live FPL API on 2026-08-29:

- **One gameweek has finished.** GW2 was in progress. Highest xG in the league
  was 1.47. Season-to-date stats are near-noise and will be for roughly a month.
- **Per-90 fields already exist** in `bootstrap-static`: `expected_goals_per_90`,
  `expected_assists_per_90`, `expected_goal_involvements_per_90`,
  `expected_goals_conceded_per_90`, `saves_per_90`, `defensive_contribution_per_90`.
  The brief's plan to rank on cumulative season totals would have rewarded whoever
  played the most games rather than who plays best.
- **Availability data is free** in the same payload: `status`,
  `chance_of_playing_next_round`, `news`. No scraping needed.
- **`defensive_contribution` is a tracked scoring stat** (FPL's DefCon rule). The
  brief omitted it entirely; it is now a major points source, especially for defenders.
- **Team strength fields are unusable**: `strength_attack_home/away` and
  `strength_defence_home/away` are `0` for all 20 teams, and `strength` is `null`.
  FDR is the only free fixture signal available.
- **FDR is coarse**: spans 2–5 only, with 45% of all 380 fixtures rated 3.
- **`element-summary` costs 0.54s per call.** All ~620 players would take ~8.7 min
  per refresh, which is why per-gameweek history is built by snapshot accumulation
  instead.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Rank on this season only, with a sample-size warning | Simplest and most honest; no last-season blending |
| D2 | Revised component set, deduplicated, DefCon included | Removes the xA/assists double-count; adds a missing signal |
| D3 | Ship all ~620 players; filter client-side with toggles | Nothing is hidden by a silent pipeline cutoff |
| D4 | Percentile-rank normalization over a **fixed** qualified pool | Immune to outliers; scores stay stable as filters change |
| D5 | Minutes-weighted shrinkage, K = 400 | Separates genuine outliers from small-sample artifacts |
| D6 | Per-gameweek history via accumulated snapshots | 2 HTTP calls per refresh instead of ~620 |
| D7 | Position tabs (GK/DEF/MID/FWD) | Percentiles are within-position, so cross-position sorting is meaningless |
| D8 | Separate MID and FWD weight sets; GK gets a saves component | DefCon matters for mids, not forwards; keepers on bad teams earn save points |
| D9 | Threshold-aware DefCon and clean sheets | Both payouts are step functions, not linear in the underlying rate |
| D10 | Set-pieces weighted by type | A penalty taker is worth far more than a corner taker |
| D11 | Price value from rate-based expected output, not accumulated points | Removes the last double-count with form |
| D12 | Public repo | GitHub Pages on a private repo requires a paid plan |
| D13 | Desktop-first, columns wrap and sliders stack on narrow screens | Primary use is desktop; phone should work, need not be beautiful |
| D14 | K = 400 default, exposed as an advanced slider | Chosen not fitted; calibration needs history v1 excludes (6.1) |
| D15 | GK fixture ease 20% -> 10%, clean-sheet chance 30% -> 40% | Saves offset clean sheets for keepers, measured at +0.38 (6.7) |
| D16 | Full expected points **per match**, not per 90 | FPL pays per match; per-90 alone ignored appearance points and minutes (§12.1) |
| D17 | Expected-minutes estimate via smoothed start probability | Minutes are the strongest single predictor; the model had none |
| D18 | xP builds the components; sliders still rank percentiles | Keeps the leaderboard product, fixes the maths underneath |
| D19 | Snapshot keyed on `finished_provisional`, not `finished` | `finished` lags the data by days; proven wrong today (§12.6) |
| D20 | Pipeline embeds GW deltas into `players.json` | One browser fetch instead of N snapshot files |
| D21 | Slider weights renormalized by their sum | Otherwise moving sliders silently changes the score's scale |
| D22 | Fixture horizon counted in **gameweeks**, not fixtures | Reverses the earlier choice: only this rewards double gameweeks |
| D23 | Quality components evaluated at a full 90; Minutes carries volume | Decouples sliders: Attack vs Minutes correlation fell 0.77 -> 0.18 (§13.2) |
| D24 | Expected minutes from **actual minutes**, not start count | `starts` is near-binary early; minutes carry strictly more information |
| D25 | Value is a **display toggle**, not a weighted slider | `xP/£m` correlated 0.94 with Minutes; it is a composite, not a signal (§13.2) |
| D26 | Clean-sheet probability carries a calibration constant | Measured −9% biased low on 240 players across 2025/26 (§13.3) |
| D27 | DefCon uses a **negative binomial**, not Poisson | Defensive actions are overdispersed (var/mean 2.24); Poisson understated MID by half (§13.7) |
| D28 | Goalkeepers have no DefCon term at all | Verified: every GK has defensive_contribution of exactly 0 (6.3) |

### Rejected

- **Blending last season as a prior** (via `history_past`). Rejected in favour of D1's simplicity.
- **Fetching `element-summary` for all or a subset of players.** Rejected: 8.7 min per run for
  everyone, or an inconsistent table where two-thirds of rows lack timeframe data.
- **Min-max normalization** (the brief's choice). Rejected: one outlier compresses the field.
  Measured on live data, the median midfielder scored **0.09** on attacking under min-max,
  making that slider nearly inert across most of the board. Percentile puts the same player at 0.49.
- **Pre-normalizing in the pipeline** (brief step 4). Rejected: normalization must stay consistent
  with the live-filtered view, so it belongs in the browser.
- **Deriving better fixture difficulty from team strength fields.** Not possible; the fields are all zero.
- **Counting the fixture horizon in fixtures rather than gameweeks** (D22 reverses this). It claimed
  double-gameweeks "fall out naturally"; they do not. Averaging difficulty over the next 5 fixtures
  treats a team playing twice as merely having easier fixtures, when the actual benefit is a second
  match's worth of points.
- **Shrinking start probability toward the position median.** Caught during model validation: the
  midfielder pool's median is **0.50 starts per team match** because it is full of fringe squad players,
  so this told the model that an ever-present starter had a 70% chance of starting. Replaced with
  Laplace smoothing toward 0.5 (6.2), after which P(start) spans 0.17–0.83 and separates properly.

## 4. Architecture

Static site on GitHub Pages from the root of a public repo. A `workflow_dispatch`
Action fetches data and commits JSON. All scoring runs in the browser. No build step.

```
fpl-assistant/
  .github/workflows/refresh-data.yml
  scripts/
    fetch.py            # HTTP + retry/backoff only
    transform.py        # bootstrap + fixtures -> players.json (pure)
    snapshot.py         # snapshot write + delta computation (pure)
    refresh.py          # entrypoint wiring the three together
    tests/              # pytest against recorded fixture JSON
  data/
    players.json
    snapshots/gw1.json, gw2.json, ...
  index.html
  src/
    scoring.js          # shrinkage, Poisson, percentile, weighted sum (pure)
    ui.js               # table, tabs, controls rendering
    app.js              # wiring + state
    styles.css
  tests/scoring.test.js # node:test, zero deps
  README.md
```

Boundaries: everything network-touching is in `fetch.py`; everything DOM-touching is
in `ui.js`. `transform.py`, `snapshot.py` and `scoring.js` are pure functions over
plain data and are tested without network or DOM.

## 5. Data pipeline

Two HTTP calls per run — `bootstrap-static` and `fixtures`. Runs in seconds.

1. Fetch both, retrying with backoff on 403/5xx, sending a real User-Agent.
   GitHub runners are occasionally Cloudflare-blocked by the FPL API.
2. Write `data/snapshots/gw{N}.json`, where **N is the highest gameweek all of whose
   fixtures are `finished_provisional`** — *not* the last `finished` gameweek (D19).
   Holds cumulative per-player totals. Re-running overwrites the same file, so the step
   is idempotent. Each snapshot records `events_finished`, `data_checked`, and per-team
   matches played, so a rolling window knows its true span even if a refresh was skipped.

   A snapshot written while `data_checked` is false is marked provisional, because bonus
   points are not final; the next run rewrites it.
3. Compute per-gameweek deltas by diffing consecutive snapshots, and **embed the last-2
   and last-4 gameweek totals directly into `players.json`** (D20). The browser then makes
   one fetch rather than requesting N snapshot files.
4. Build `data/players.json`: every player, raw values only, no normalization, plus a
   `schema_version` field and the embedded deltas from step 3.
5. **Validation gate before commit.** Refuse to write if the player count is
   implausibly low or required fields are missing. A bad refresh leaves the last
   good data in place rather than replacing it with garbage.
6. Commit both files. Workflow needs `permissions: contents: write`.

## 6. Scoring model

Computed entirely in the browser, so both sliders and filters recompute live.

The model estimates **expected points per match** (D16). FPL pays per match, not per 90
minutes; the earlier per-90-only version omitted appearance points entirely and was
measured to understate a defender's real total by 38% (§12.1).

### 6.1 Shrinkage

Every per-90 rate is pulled toward its position median, weighted by minutes played:

```
adj = (mins * rate + K * median) / (mins + K)      K = 400 (default)
```

The position median is computed over players with >= 90 minutes when at least 10
qualify, otherwise over all players with any minutes.

**On the value of K.** K is a scepticism dial: the number of minutes of league-average
play mixed in before a player's own record is trusted. At K = 400 a player on 180 minutes
is judged 31% on their own data; at 800 minutes, 82%. Low K lets small-sample flukes reach
the top; high K flattens everyone toward the median.

**K = 400 is a chosen value, not a fitted one.** Roughly 4.5 full matches, picked so a
single big game cannot manufacture an elite rating while a half-season record still
dominates. Calibrating it properly requires historical data, which D1 excludes from v1.
So **K defaults to 400 and is exposed as an advanced slider**; calibration is a v2 item (§10).

Measured: raw `xGI/90` ranked a player with **1 minute played** at #2 among midfielders and
an 8-minute player at #4. Shrinkage moved them to #62 and #40 while lifting a genuine
performer from #12 to #2. A real outlier keeps its rank; an artifact regresses.

### 6.2 Expected minutes (D17)

Minutes are the strongest single predictor in FPL and the original spec had no estimate
of them — only a filter. Start probability uses Laplace smoothing toward 0.5:

```
exp_mins = shrink_matches(minutes / team_matches_played) * availability
p60      = min(1, exp_mins / 85)          # probability of reaching 60 minutes
```

Expected minutes are estimated from **actual minutes played**, not from start count (D24).
`starts` is effectively binary in the opening weeks — a player who played 90 and one who
played 62 both register one start — while minutes are continuous and strictly more
informative. Shrinkage is over matches played, toward the position median.

An earlier draft used `((starts + 0.5) / (matches + 1)) * 85`. It is kept here only as the
rejected alternative; see §13.1 for why the backtest could not adjudicate between them and
the change was made on information content instead.

`availability` is 1.0 for `status == 'a'` with no flag, `chance_of_playing_next_round / 100`
when that field is set, and 0 for unavailable players.

**Why 0.5 and not the position median.** Shrinking toward the pool median was tried and is
wrong: the midfielder pool's median is **0.50 starts per team match**, because the pool is
mostly fringe squad players. That prior told the model an ever-present starter had a 70%
chance of starting, and flattened the appearance term to a constant. With Laplace smoothing
the spread is 0.17–0.83 after two matches and converges toward the truth as matches accumulate.

`85` is typical minutes for a player who starts. **Cameo appearances are deliberately ignored** —
a player who only comes off the bench is one the minutes filter removes anyway. This slightly
understates squad players and is documented rather than hidden.

`team_matches_played` counts fixtures with `finished_provisional` set, consistent with D19.

### 6.3 Expected points per match

Every per-90 rate is scaled by `f = exp_mins / 90` before use, so a 60-minute player is not
credited with a 90-minute player's output.

```
xP = 2 * p_start                                    # appearance points
   + (xG/90 * goal_pts + xA/90 * 3) * f             # attacking returns
   + exp(-xGC/90 * f) * p_start * cs_pts            # clean sheet
   - (xGC/90 * f) / 2                               # goals conceded   [GK/DEF only]
   + (saves/90 * f) / 3                             # save points      [GK only]
   + P_nb(defensive actions >= T) * 2               # DefCon, negative binomial (D27)
   + bonus_per_match                                # smoothed observed bonus
```

| Position | goal_pts | cs_pts | DefCon threshold T | NB dispersion r |
|---|---|---|---|---|
| GK | 6 | 4 | **n/a** | – |
| DEF | 6 | 4 | 10 | 5.79 |
| MID | 5 | 1 | 12 | 10.21 |
| FWD | 4 | 0 | 12 | Poisson (see below) |

**Goalkeepers have no DefCon term (D28).** Verified against live data: every goalkeeper has
`defensive_contribution` of exactly 0 — mean 0.00, max 0.00, and zero in every per-match row.
FPL does not award DefCon to keepers. An earlier draft gave them T = 10, which was harmless
in arithmetic (lambda was always 0) but wrong as a description of the game.

**Forwards keep Poisson.** Their measured variance-to-mean ratio was 0.93 — slightly *under*
dispersed, so the negative binomial has nothing to correct. Their DefCon contribution is
negligible in any case: mean 4.38 actions per 90 against a threshold of 12.

Clean-sheet points require 60 minutes played, which is why that term is multiplied by
`p_start` rather than by `f`.

`bonus_per_match` uses **observed** bonus per team match, Laplace-smoothed — measured rather
than modelled, so no BPS-to-bonus mapping has to be invented.

**Why the scaling matters, measured.** For a player with a shrunk rate of 9.28 defensive
actions per 90, the chance of reaching the 10-action threshold is:

| minutes played | P(reach 10) |
|---|---|
| 90 | 44.9% |
| 75 | 25.1% |
| 60 | 9.7% |
| 45 | 2.1% |

The previous spec used 44.9% for all of them.

**Scope note.** This is a light expected-points model, past the line the brief drew for v1.
It remains deterministic arithmetic over published rates — no training, no fitting, nothing
learned — but the line has moved deliberately, not by drift.

### 6.4 Which distribution, and why

**Clean sheets use Poisson. DefCon uses a negative binomial (D27).** Same job — turn an
average into the odds of each count — but the two events behave differently, and the choice
was tested rather than assumed.

Poisson carries one assumption: the rate is steady from match to match, which forces
variance to equal the mean. Goals conceded satisfy this — they are rare and roughly
independent, and §13.3 confirms the clean-sheet model is well behaved.

Defensive actions do not. A team pinned in its own half racks up clearances in clusters;
a dominant team barely defends. The rate itself swings by match. Measured across 398
player-matches, **variance was 2.24x the mean for defenders and 1.71x for midfielders** —
so Poisson understates the tails and, with it, the chance of clearing the threshold.

The negative binomial adds a dispersion parameter `r` for exactly this, with
`variance = mu + mu^2 / r`, fitted from the observed variance-to-mean ratio:

```
r = mu / (variance/mean - 1)          measured: DEF 5.79, MID 10.21
```

Lower `r` means more clustering. Results in §13.7.

Poisson turns an average rate into the odds of each discrete count. Given a team expected
to concede 1.46 goals, it gives P(0 conceded) = 23.2%, P(1) = 33.9%, P(2) = 24.8%, and so on.
`exp(-lambda)` is simply the P(0) case. The same tool, aimed at the upper tail, gives the
DefCon threshold probability. Football goal counts are conventionally modelled this way.

### 6.5 Threshold effects, and why a distribution is needed at all

DefCon and clean sheets pay out as **step functions**: 2 points at 10+ defensive actions,
nothing below; 4 points for a shutout, nothing for conceding one.

Measured: the median defender records **7.0** defensive actions per 90 against a threshold of
10, and **20 of 68** qualifying defenders sit in the 8-12 band, right on the cliff. Treated
linearly, 9.0 -> 10.5 (worth ~2 points every game) and 3.0 -> 4.5 (worth nothing) score as
identical improvements.

### 6.6 Set-piece bonus (D10)

| Duty | 1st choice | 2nd choice | 3rd or lower |
|---|---|---|---|
| Penalties | 1.0 | 0.5 | 0 |
| Direct free kicks | 0.5 | 0.25 | 0 |
| Corners / indirect | 0.3 | 0.15 | 0 |

A player's set-piece score is the maximum across the three duties. Orders of 3 or lower
score zero, stated explicitly rather than left to fall through.

### 6.7 Fixture projection (D22)

The horizon is counted in **gameweeks**, not fixtures — the reverse of the original spec.

```
fixture_factor = sum over matches in the next N gameweeks of (6 - FDR) / 3
```

A team with a double gameweek contributes two matches and scores roughly double; a blank
gameweek contributes nothing. Averaging difficulty across "the next 5 fixtures", as originally
specified, could not express either: it treated a team playing twice as merely having easier
fixtures, when the real benefit is a second match's worth of points.

FDR is `team_h_difficulty` at home and `team_a_difficulty` away. Horizon defaults to **5
gameweeks**, switchable to 3 or 8. Fixtures with `event: null` are excluded (there are none
today, but the endpoint permits them).

**FDR is coarse** — it spans 2-5 with 45% of fixtures rated 3 — and there is no better free
alternative, since the team strength fields are all zero (§2).

### 6.8 Normalization (D4)

Each component is converted to a **percentile rank within position group**, over a **fixed
qualified pool**:

```
qualified = minutes >= max(90, 0.25 * team_available_minutes_so_far)
```

The threshold scales with the season. A flat 90-minute cut works today but is meaningless by
GW20, when nearly every squad player clears it and the pool dilutes to include deep-bench
players. If fewer than 10 players qualify, the pool falls back to the top 30 by minutes.

The pool is fixed deliberately. Normalizing over the live-filtered set would make a player's
score change meaning as filters move — narrowing to 20 players could turn a 0.95 into a 0.60.
Filters control which rows display, never what a score means.

Percentile was chosen over min-max because one outlier compresses the field: measured on live
data, the median midfielder scored **0.09** on attacking under min-max, making that slider
nearly inert. Percentile puts the same player at 0.49.

### 6.9 Components and weights

Components are built from the xP terms in 6.3 (D18). The sliders weight their percentiles,
so the leaderboard behaves as designed while the arithmetic underneath reflects real scoring.

| Component | Built from | GK | DEF | MID | FWD |
|---|---|---|---|---|---|
| Attack quality | goals + assists terms, **at a full 90** | – | 10% | 35% | 40% |
| Defence quality | clean sheet + DefCon − conceded + saves, **at a full 90** | 45% | 30% | 5% | – |
| Minutes security | `exp_mins` (6.2) — carries all volume | 20% | 20% | 20% | 20% |
| Fixture projection | `fixture_factor` (6.7) | 10% | 10% | 15% | 15% |
| Form | `form` | 25% | 15% | 15% | 15% |
| Set-pieces | duty-weighted (6.6) | – | 15% | 10% | 10% |

Each column sums to 100%. Saves and the goals-conceded deduction sit inside Defence quality.

**Quality is measured at a full 90 minutes; Minutes security carries the volume (D23).**
Previously every rate was multiplied by `exp_mins / 90` before becoming a component, so the
Attack slider silently dragged minutes with it — measured at **0.77** correlation. Separating
them dropped that to **0.18**. Expected points is still quality × minutes; only the *sliders*
are now independent, which is what the UI implies.

**Value is a display toggle, not a slider (D25).** `xP / price` correlated **0.94** with Minutes
for midfielders — because xP is minutes-dominated, so xP per million is close to minutes per
million. It is a composite of the other components rather than a signal of its own, and giving
it a slider misrepresents that. Instead the board has a **"per £m" toggle** that divides the
final weighted score by price. That is exactly what value means, and it double-counts nothing.

**Known residual overlap:** Form still correlates 0.55 (DEF) to 0.77 (MID) with Minutes, because
`form` is points *per match* and therefore includes appearance points. Documented rather than
fixed; removing it would need a per-90 form built from accumulated snapshots (v2).

**Weights renormalize (D21).** Defaults sum to 100%, but the user can drag sliders anywhere.
The score divides by the sum of active weights, so it always stays on 0–1 and moving one
slider cannot silently rescale the board. The UI shows each slider's *effective* percentage
beside it.

**Form** is bootstrap's `form` field: points per game over the trailing 30 days, roughly the
last 4 gameweeks. Used as published, without shrinkage, since it is already an average.
It is the one component still expressed per match rather than per 90 — accepted, since that
is also the unit FPL pays in.

### 6.10 Fixture difficulty overlaps clean-sheet chance — measured, then sized

Fixture difficulty enters twice for GK and DEF: inside the clean-sheet term (6.3) and again
as the fixture projection. Both were measured rather than assumed.

**Defenders: left at 10%.** The correlation between fixture ease and clean-sheet chance across
88 qualifying defenders is **0.34** — only ~12% shared variation. Clean-sheet chance is driven
mainly by a team's own defensive quality, not by opponent. Fixture projection also does
independent work: a defender facing weak sides gets more attacking opportunities, and a double
gameweek is worth a second match regardless of defensive quality.

**Goalkeepers: 10%, reduced from 20% (D15).** For keepers, hard fixtures partly pay for
themselves. The correlation between `expected_goals_conceded_per_90` and `saves_per_90` across
21 qualifying keepers is **+0.38**: Raya behind the best defence makes 1.0 saves per 90, Bizot
behind the worst makes 3.0. Save points push against clean-sheet points, so weighting fixture
ease heavily counts one direction twice while ignoring the offset.

## 7. Frontend

Four position tabs. Each shows that position's weight sliders, a sortable table, and
filter toggles: hide unavailable, minutes threshold, team, price range.

**Controls not previously specified:**

- **Timeframe selector** — season to date / last 4 GWs / last 2 GWs, reading the deltas the
  pipeline embeds in `players.json` (D20). The original spec built snapshots for this feature
  but never gave it a control, which §12.8 caught.
- **Fixture horizon** — 3 / 5 / 8 gameweeks (6.7).
- **K (advanced)** — the shrinkage dial from 6.1, so its effect is visible rather than hidden.
- Each slider shows its **effective percentage** after renormalization (D21).

Each row shows the weighted score, a **projected points** column giving raw xP over the
selected horizon as a sanity check against the weighted ranking, the raw values feeding the
score, minutes and `p_start`, an availability badge from `status`/`news`, and an **outlier
badge** for any player more than 2 SD above their position field. Showing raw values beside the score is deliberate: percentile discards
magnitude, so the magnitude has to remain visible for a genuine outlier to be recognisable.

A banner shows the last-updated timestamp and, until roughly GW6, the sample-size
warning: `"Only N gameweeks played — treat rankings as noisy."`

The `players.json` fetch is cache-busted with a query parameter; the Pages CDN will
otherwise serve stale data after a refresh.

Desktop-first (D13): dense table with all columns and sliders visible. On narrow
screens columns wrap and sliders stack. No separate mobile design.

## 8. Failure modes

| Failure | Handling |
|---|---|
| FPL API blocked from the runner | Retry with backoff, then fail the Action without committing |
| Malformed or truncated API response | Validation gate rejects; last good data stays in place |
| `players.json` missing or unfetchable | Explicit error state in the UI, never a silently empty table |
| Stale data after refresh | Cache-busting query parameter on fetch |
| Skipped refresh leaves a snapshot gap | Windows report their real span via `events_finished` |
| Fewer than 10 qualifying players in a pool | Documented fallback to top 30 by minutes (6.8) |
| `finished` flag lags the played fixtures | Snapshots key on `finished_provisional`; provisional snapshots rewritten once `data_checked` (D19) |
| Player has no `starts` yet | Laplace smoothing gives a defined `p_start`; no division by zero (6.2) |
| Team has a blank gameweek in the horizon | `fixture_factor` contributes zero for that gameweek, correctly (6.7) |
| Sliders all set to zero | Weight sum is zero; UI falls back to equal weights rather than dividing by zero |
| `players.json` schema changes | `schema_version` checked on load; mismatch shows an explicit "refresh needed" state |

## 9. Testing

**pytest** over recorded fixture JSON for `transform.py` and `snapshot.py`, including
the "1 gameweek played" case — today's actual state and the edge case most likely to break.
Also: snapshot gap handling, and the validation gate rejecting bad payloads.

**node:test** (zero dependencies) for `scoring.js`: shrinkage math, Poisson threshold
probabilities, percentile with ties, empty and single-player pools, set-piece duty precedence
including 3rd-choice, weight renormalization (including the all-zero case), expected-minutes
smoothing at zero starts, and xP scaling by minutes — specifically that the DefCon probability
falls as expected minutes fall, the regression §12.5 describes.

Also a **golden-output test**: the four position rankings computed from a recorded payload,
asserted against a checked-in expected result, so a maths change that silently reorders the
board fails loudly.

## 10. Out of scope for v1

- Squad or transfer recommendations tied to a specific team
- Injury news scraping or expert-opinion aggregation (availability comes free from the API)
- Trained or fitted predictive models
- Chip strategy advice
- Deriving team strength from accumulated xG/xGC — possible v2 once enough gameweeks exist
  to make it meaningful, and the only route to better fixture difficulty than FDR
- Calibrating K against accumulated snapshots, replacing the chosen 400 with a fitted value (6.1)

## 11. Open items before implementation

1. ~~Confirm the repo may be public~~ — **confirmed, public.**
2. ~~Confirm repo name and account~~ — **confirmed, `NahidRM/fpl-assistant`.**
3. Creating the GitHub repo is an outward-facing action and awaits explicit approval.

## 12. Critical review log — 2026-08-30

A cold review of the v1 spec found one proven bug and a cluster of scoring errors. Recorded
so the reasoning is not lost and the same ground is not re-covered.

**12.1 Appearance points were missing entirely.** Every player reaching 60 minutes earns 2
points. For a worked defender the model counted 2.10 points per game against a realistic 3.37 —
**appearance points were 59% of the true total and the formula understated it by 38%.** Since
this fed price value, the component whose whole job is finding bargains, it was the single most
consequential error. Fixed in 6.3.

**12.2 Goals-conceded deduction was missing.** GK and DEF lose 1 point per 2 goals conceded,
about −0.73 per game for the worked example. Fixed in 6.3.

**12.3 Save points were missing from the value calculation.** Saves were a weight component for
keepers but absent from the expected-points figure feeding their value, so goalkeeper value was
understated in a way defenders' was not. Fixed by folding saves into Defensive xP (6.9).

**12.4 Bonus points were not modelled.** Now included as observed bonus per match (6.3).

**12.5 The model was per-90 while FPL pays per match.** Root cause of the above. The DefCon
probability was computed as if every player played 90 minutes, crediting a 60-minute player with
44.9% where the true figure is 9.7%. Fixed by scaling all rates by `exp_mins / 90` (6.3).

**12.6 The snapshot label was wrong — demonstrated, not theoretical.** The spec keyed snapshots on
the last `finished` gameweek. At the time of review GW2 was `finished: false` and `data_checked:
false`, yet **9 of its 10 fixtures were `finished_provisional` and player minutes already reached
180 — two full matches**. A refresh would have written two gameweeks of data under a GW1 label,
corrupting every delta computed from it. Fixed by D19.

**12.7 Slider weights did not renormalize.** Undefined behaviour in the app's central interaction.
Fixed by D21.

**12.8 The timeframe feature was half-specified.** Snapshots were built for it and justified in
D6, but no frontend control existed and no data path was defined. Fixed by D20 and §7.

**12.9 The qualification threshold did not age.** A flat 90 minutes is sensible in August and
meaningless by GW20. Fixed by scaling it to a share of available minutes (6.8).

**12.10 Double gameweeks were diluted rather than rewarded.** Fixed by D22.

**12.11 Found during validation, not review.** Shrinking start probability toward the position
median told the model an ever-present starter had a 70% chance of starting, because the pool
median is 0.50 and the pool is mostly fringe players. Caught only by running the model and
noticing the appearance column was constant. Fixed in 6.2.

**Still open, accepted:** yellow and red cards, own goals and penalty misses are not modelled;
`form` remains per match while the rest of the model is per 90 (6.9); cameo appearances are
ignored in expected minutes (6.2).

## 13. Model validation results — 2026-08-30

Tests run against real data before any application code was written. Method and expectations
were fixed in advance; results are reported as found.

### 13.1 Backtest: GW1 model predicting GW2 (n = 278)

| predictor | Spearman |
|---|---|
| our xP model | 0.237 |
| GW1 points (form baseline) | 0.220 |
| price | 0.196 |
| **GW1 minutes alone** | **0.312** |
| random | 0.046 |

Approximate SE is 0.060, so **differences below ~0.12 are noise**, and this is a single
gameweek — 278 players clustered into 19 team-matches, so the effective sample is far smaller.

**Conclusion: the model is clearly better than random and is not broken, but it does not
demonstrably beat simple baselines.** Raw minutes played last week numerically outscored it.

Variants tested: expected minutes from actual minutes scored 0.254, a 50/50 blend 0.258, against
0.237 for start count. **All inside noise.** The change to minutes (D24) was made on information
content, not on these numbers — selecting a winner from gaps a third the size of the noise
threshold would be fitting one gameweek.

### 13.2 Component correlation

Before decoupling, defender components formed a redundancy cluster: Minutes/Value **0.86**,
Attack/Minutes **0.77**, Attack/Value **0.76**, Form/Value **0.75**. Seven sliders were
expressing roughly three independent dimensions.

After D23 and D25: Attack/Minutes **0.18** (DEF), **0.33** (MID). Defence quality is near-zero
against everything. Fixtures and Set-pieces were independent throughout. Form/Minutes remains
0.55–0.77 and is documented in 6.9 rather than fixed.

### 13.3 Clean-sheet calibration on 2025/26 (n = 240, 38 games each)

The one test with enough events to be conclusive, using `history_past` season aggregates.

| P(CS) bucket | n | predicted | actual | error |
|---|---|---|---|---|
| 10–20% | 16 | 17.3% | 23.5% | −6.2% |
| 20–30% | 178 | 25.1% | 27.4% | −2.3% |
| 30–40% | 34 | 32.1% | 36.9% | −4.8% |
| 40–50% | 7 | 46.8% | 46.8% | −0.0% |
| 50%+ | 4 | 54.0% | 52.8% | +1.3% |

Totals: **1,420 predicted vs 1,560 actual, −9.0% biased low.** Spearman between predicted and
actual clean-sheet counts is **0.871**; MAE is 1.44 clean sheets per player-season.

**The Poisson clean-sheet model ranks extremely well and is mildly biased low.** The bias is
uniform enough to be corrected with a single constant (D26). It matters little for the
leaderboard, which is rank-based, but it matters for the projected-points column.

**DefCon could not be calibrated from `history_past`**, which records season totals but not
per-match counts. It was instead tested from current-season per-gameweek rows — see §13.7.

### 13.4 Out-of-sample: 2025/26 model predicting 2026/27 (n = 240)

| predictor | Spearman |
|---|---|
| our xP model, built on 2025/26 only | 0.322 |
| last season's points per game | 0.326 |
| current price | 0.291 |

By position: GK 0.751, MID 0.420, FWD 0.208, DEF 0.167.

**Same conclusion as 13.1 from independent data: the model is indistinguishable from
"use last season's points per game."** Defenders are the weakest case for every predictor
including the baselines, suggesting they are intrinsically hard rather than that the model
fails on them specifically.

### 13.5 Parameter sensitivity

Top-20 defenders retained as K varies: K=100 16/20, K=200 18/20, K=800 18/20, K=1600 18/20.
**K being an unfitted guess does not materially affect the board.** Concern retired.

### 13.6 What this means

Established: the model is sound, its clean-sheet machinery ranks well, and its parameters
are robust. **Not established: that it beats simple heuristics on predictive accuracy.**
Two independent tests failed to show an edge over last season's points per game or over
minutes played.

The product case does not rest solely on accuracy — the value is in weighting fixtures,
set-pieces and minutes explicitly, and in seeing why a player ranks where they do. But
**the README must not claim predictive superiority that has not been demonstrated.**

Re-run 13.1 and 13.4 once 8–10 gameweeks of snapshots exist; that is the first point at which
a real edge could be detected.

### 13.7 DefCon distribution test (n = 398 player-matches, 60+ minutes)

Testable from the current season's per-gameweek `history` rows, which carry
`defensive_contribution` — an earlier note wrongly said this had to wait for snapshots.

| position | n | mean | var/mean | observed P(hit T) | Poisson | negative binomial |
|---|---|---|---|---|---|---|
| DEF (T=10) | 160 | 7.20 | **2.24** | 23.1% | 19.0% | **25.0%** |
| MID (T=12) | 164 | 7.29 | **1.71** | 12.8% | 6.8% | **12.1%** |

Error against observed: Poisson −4.1 and −6.0 percentage points; negative binomial +1.9 and
−0.7. **Poisson understated midfielders by nearly half.** Fitted dispersion: DEF `r` = 5.79,
MID `r` = 10.21.

**Caveat, stated plainly:** `r` was fitted on the same 398 matches used to evaluate it, so the
threshold figures are in-sample and overstate how well it will do on new data. What is *not*
in-sample is the variance-to-mean ratio itself — that 2.24 is a structural property of the
data and is the actual justification for the change. Refit `r` and re-validate on held-out
gameweeks at GW10.
