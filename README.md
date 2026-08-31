# FPL Assistant

A personal Fantasy Premier League player-ranking board. Static site on GitHub Pages,
refreshed by a manually-triggered GitHub Action. No backend, no database, no paid APIs.

## How it works

1. **Refresh** — run the *Refresh FPL data* workflow from the Actions tab. It fetches
   `bootstrap-static` and `fixtures`, writes a gameweek snapshot, and commits
   `data/players.json`.
2. **Rank** — the browser reads that JSON and computes all scoring locally, so the
   weighting sliders and filters respond instantly.

## Honest limitations

- **This has not been shown to predict better than simple heuristics.** In two independent
  tests the model tied with "sort by last season's points per game" and was outscored by
  "minutes played last week". It clearly beats random, and its clean-sheet component ranks
  well, but no predictive edge has been demonstrated. See section 13 of the design spec.
- The value here is explicit control over fixtures, minutes and set-pieces, and being able
  to see *why* a player ranks where they do — not superior forecasting.
- Early in a season the rankings are noisy. The board says so until roughly gameweek 6.

## Development

```bash
python3 -m pytest            # run the pipeline test suite
python3 scripts/refresh.py   # refresh data locally
```

## Design

`docs/superpowers/specs/2026-08-29-fpl-assistant-design.md` — includes the validation
results, the measurements behind each decision, and what remains untested.
