"""Per-gameweek snapshots and the window deltas derived from them. Pure functions."""
from scripts.transform import last_complete_gameweek, team_matches_played

ZERO = {"minutes": 0, "total_points": 0, "bonus": 0}


def build_snapshot(bootstrap, fixtures):
    """Cumulative per-player totals, labelled with the last complete gameweek."""
    gameweek = last_complete_gameweek(fixtures)
    events = {event["id"]: event for event in bootstrap.get("events", [])}
    current_event = events.get(gameweek) or {}

    return {
        "gameweek": gameweek,
        "data_checked": bool(current_event.get("data_checked")),
        "events_finished": sum(1 for e in bootstrap.get("events", []) if e.get("finished")),
        "team_matches_played": {str(k): v for k, v in team_matches_played(fixtures).items()},
        "players": {
            str(element["id"]): {
                "minutes": element["minutes"],
                "total_points": element["total_points"],
                "bonus": element["bonus"],
                "team": element["team"],
            }
            for element in bootstrap["elements"]
        },
    }


def compute_window(current, history, gameweeks):
    """Per-player totals over the trailing `gameweeks` window.

    `history` maps gameweek number to a previously written snapshot. Returns {} when no
    suitable baseline exists.

    `matches` is the number of matches *that player's team* played between the baseline and
    now. It is per-team on purpose: measured on live data, one outstanding fixture left 18 of
    20 teams on 2 matches while the snapshot label was still gw1, so a single global span
    would have been wrong for 18 of them.
    """
    current_gameweek = current.get("gameweek")
    if current_gameweek is None:
        return {}

    target = current_gameweek - gameweeks
    candidates = sorted(gw for gw in history if gw <= target)
    if not candidates:
        return {}

    baseline = history[candidates[-1]]
    baseline_players = baseline["players"]
    baseline_matches = baseline.get("team_matches_played", {})
    current_matches = current.get("team_matches_played", {})

    out = {}
    for player_id, totals in current["players"].items():
        before = baseline_players.get(player_id, ZERO)
        team = str(totals.get("team", before.get("team", "")))
        span = int(current_matches.get(team, 0)) - int(baseline_matches.get(team, 0))
        out[player_id] = {
            "minutes": totals["minutes"] - before["minutes"],
            "points": totals["total_points"] - before["total_points"],
            "bonus": totals["bonus"] - before["bonus"],
            "matches": max(span, 0),
        }
    return out
