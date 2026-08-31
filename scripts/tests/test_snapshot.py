from scripts.snapshot import build_snapshot, compute_window


def _snapshot(gameweek, players, team_matches=None):
    return {
        "gameweek": gameweek,
        "data_checked": True,
        "team_matches_played": team_matches or {"1": gameweek or 0},
        "players": players,
    }


def test_build_snapshot_records_cumulative_totals(bootstrap, fixtures):
    snap = build_snapshot(bootstrap, fixtures)
    assert "gameweek" in snap and "players" in snap
    first = bootstrap["elements"][0]
    entry = snap["players"][str(first["id"])]
    assert entry == {
        "minutes": first["minutes"],
        "total_points": first["total_points"],
        "bonus": first["bonus"],
        "team": first["team"],
    }


def test_build_snapshot_records_per_team_match_counts(bootstrap, fixtures):
    snap = build_snapshot(bootstrap, fixtures)
    assert snap["team_matches_played"], "needed to compute a per-team span"
    assert all(isinstance(v, int) for v in snap["team_matches_played"].values())


def test_window_delta_subtracts_baseline():
    current = _snapshot(5, {"1": {"minutes": 450, "total_points": 30, "bonus": 6, "team": 1}})
    history = {3: _snapshot(3, {"1": {"minutes": 270, "total_points": 18, "bonus": 4, "team": 1}})}
    out = compute_window(current, history, 2)
    assert out["1"] == {"minutes": 180, "points": 12, "bonus": 2, "matches": 2}


def test_window_reports_true_span_when_a_refresh_was_skipped():
    current = _snapshot(6, {"1": {"minutes": 540, "total_points": 36, "bonus": 8, "team": 1}})
    history = {2: _snapshot(2, {"1": {"minutes": 180, "total_points": 12, "bonus": 2, "team": 1}})}
    out = compute_window(current, history, 2)
    assert out["1"]["matches"] == 4, "must report the real span, not the requested one"


def test_span_is_per_team_not_global():
    # Measured on live data: with one fixture outstanding, 18 of 20 teams had played
    # 2 matches while the snapshot label was still gw1. A global span is wrong for them.
    current = _snapshot(3, {
        "1": {"minutes": 270, "total_points": 18, "bonus": 3, "team": 1},
        "2": {"minutes": 180, "total_points": 12, "bonus": 2, "team": 2},
    }, team_matches={"1": 3, "2": 2})
    history = {1: _snapshot(1, {
        "1": {"minutes": 90, "total_points": 6, "bonus": 1, "team": 1},
        "2": {"minutes": 90, "total_points": 6, "bonus": 1, "team": 2},
    }, team_matches={"1": 1, "2": 1})}
    out = compute_window(current, history, 2)
    assert out["1"]["matches"] == 2
    assert out["2"]["matches"] == 1, "team 2 played one fewer match in the same span"


def test_window_returns_empty_without_enough_history():
    current = _snapshot(2, {"1": {"minutes": 180, "total_points": 12, "bonus": 2}})
    assert compute_window(current, {}, 4) == {}


def test_player_absent_from_baseline_treated_as_zero():
    current = _snapshot(4, {"9": {"minutes": 90, "total_points": 7, "bonus": 1, "team": 1}})
    history = {2: _snapshot(2, {}, team_matches={"1": 2})}
    out = compute_window(current, history, 2)
    assert out["9"] == {"minutes": 90, "points": 7, "bonus": 1, "matches": 2}


def test_window_is_none_safe_when_current_gameweek_unknown():
    current = _snapshot(None, {"1": {"minutes": 0, "total_points": 0, "bonus": 0, "team": 1}})
    assert compute_window(current, {1: _snapshot(1, {})}, 2) == {}
