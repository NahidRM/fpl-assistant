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


# --- survivor 6: negative window spans clamped to zero ---
# compute_window uses max(span, 0).  Without the clamp, a player whose team played
# fewer matches in the "current" snapshot than in the baseline (can't happen in
# normal usage, but can happen with corrupted snapshots or test data) would produce
# a negative `matches` value, which downstream code treats as NaN-like.
def test_window_span_is_clamped_to_zero_not_negative():
    """span = current_matches - baseline_matches must never be negative."""
    current = _snapshot(5, {"1": {"minutes": 90, "total_points": 6, "bonus": 1, "team": 1}},
                        team_matches={"1": 1})  # fewer team matches than baseline
    history = {3: _snapshot(3, {"1": {"minutes": 90, "total_points": 6, "bonus": 1, "team": 1}},
                            team_matches={"1": 3})}
    out = compute_window(current, history, 2)
    assert out["1"]["matches"] >= 0, (
        f"matches span must be >= 0, got {out['1']['matches']}. "
        "Negative spans indicate a corrupted snapshot pair and should be clamped."
    )


# --- survivor 7: window baseline picks latest snapshot AT OR BEFORE the target GW ---
# target = current_gameweek - window_size.  The baseline must be the most recent
# snapshot whose gameweek <= target — not just the most recent snapshot overall.
# Without the `gw <= target` filter, a snapshot at GW4 could be used as the baseline
# for a GW3-window computation, giving a negative or zero delta.
def test_window_uses_latest_snapshot_at_or_before_target_not_just_latest():
    """With GWs 3 and 5 in history and current=7, a 2-GW window targets GW5.
    The baseline should be GW5, not GW3 (the oldest), giving the 2-GW delta."""
    current = _snapshot(7, {"1": {"minutes": 630, "total_points": 42, "bonus": 9, "team": 1}},
                        team_matches={"1": 7})
    history = {
        3: _snapshot(3, {"1": {"minutes": 270, "total_points": 18, "bonus": 3, "team": 1}},
                    team_matches={"1": 3}),
        5: _snapshot(5, {"1": {"minutes": 450, "total_points": 30, "bonus": 6, "team": 1}},
                    team_matches={"1": 5}),
    }
    out = compute_window(current, history, 2)  # target = 7 - 2 = 5 → baseline = GW5
    # Correct: 630-450=180 minutes, 42-30=12 points, 9-6=3 bonus, 7-5=2 matches.
    assert out["1"]["minutes"] == 180, (
        f"2-GW window from GW7 should use GW5 as baseline, giving 180 mins delta. "
        f"Got {out['1']['minutes']} (GW3 would give 360, wrong baseline)."
    )
    assert out["1"]["matches"] == 2
