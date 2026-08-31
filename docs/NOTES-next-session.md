# Notes for next session — picked up 2026-08-31

## Where things stand

Spec is complete and validated at `docs/superpowers/specs/2026-08-29-fpl-assistant-design.md`
(602 lines). **Nothing has been built. Nothing committed. No GitHub repo created.**

Confirmed: repo will be **public**, named **`NahidRM/fpl-assistant`**. Creating it is the only
remaining item in §11 and needs an explicit go-ahead.

## Answered overnight: how to test DefCon

I said this couldn't be tested until snapshots accumulate. **That was wrong** — the current
season's `element-summary` → `history` rows carry `defensive_contribution` per gameweek, so
the structural half is testable today. Ran it on 398 player-matches of 60+ minutes:

| position | n | mean | variance | var/mean | observed P(hit threshold) | Poisson predicts |
|---|---|---|---|---|---|---|
| DEF | 160 | 7.17 | 16.09 | **2.24** | 22.5% | 18.7% |
| MID | 164 | 7.30 | 12.62 | **1.73** | 12.8% | 6.8% |
| FWD | 36 | 3.86 | 3.61 | 0.93 | 0.0% | 0.1% |

**Poisson assumes variance equals mean. Defensive actions are roughly twice that.** The
consequence is measured, not theoretical: the model **understates** DefCon probability by
about a fifth for defenders and **by nearly half for midfielders**.

Cause is almost certainly game state — a team pinned back racks up clearances in clusters,
so actions arrive in bursts rather than at a steady rate. That is textbook overdispersion.

**Recommended fix: replace Poisson with a negative binomial** for the DefCon term only.
It has a second parameter for exactly this, fitted from the observed variance-to-mean ratio.
Clean sheets should **stay Poisson** — §13.3 showed that half is well behaved.

Caveat: 398 player-matches from 2 gameweeks. The dispersion ratio is solid; the exact
threshold probabilities are not. Refit at GW10.

### Still needs the GW10 data
Bucket-by-bucket calibration — group players by predicted P(threshold), check the observed
hit rate in each bucket. Needs many more matches for the buckets to have enough events.

## GW10 retest plan (confirmed wanted)

Re-run, in this order:
1. **Backtest across all gameweeks** (§13.1 method, but many prediction rounds instead of one).
   This is the first point a genuine edge over baselines could actually be detected.
2. **DefCon bucket calibration** and refit the negative binomial parameter.
3. **Refit the clean-sheet constant `c_cs`** (§13.3 measured −9% bias).
4. **Re-run parameter sensitivity** — expect K to still not matter.

Success criterion, set in advance so it can't be moved later: **beat "last season's points per
game" and "minutes played" by more than the margin of error.** §13.4 currently shows a tie.

## Open questions from last session

- Does §13.4 (model ties with simple baselines) change the appetite — build as designed, or
  simplify? Not yet answered.
- Agreed regardless: show the simple baseline as a visible column in the app, and keep any
  claim of predictive superiority out of the README until it is demonstrated.

## Two things NOT to forget

- **Do not tune the model on small samples.** §13.1 tested three variants; the spread was a
  third of the noise threshold. The change that was made was justified on information content,
  not on those numbers.
- The `starts` field is fine, but **`events[].finished` lags the played fixtures by days** —
  the snapshot logic must key on `finished_provisional` (D19). This was a proven bug, not a
  hypothetical one.
