from scripts.transform import last_complete_gameweek, team_matches_played


def test_last_complete_gameweek_uses_finished_provisional_not_finished():
    fx = [
        {"event": 1, "team_h": 1, "team_a": 2, "finished": True, "finished_provisional": True},
        {"event": 2, "team_h": 1, "team_a": 2, "finished": False, "finished_provisional": True},
    ]
    assert last_complete_gameweek(fx) == 2


def test_gameweek_incomplete_when_any_fixture_outstanding():
    fx = [
        {"event": 1, "team_h": 1, "team_a": 2, "finished_provisional": True},
        {"event": 2, "team_h": 1, "team_a": 2, "finished_provisional": True},
        {"event": 2, "team_h": 3, "team_a": 4, "finished_provisional": False},
    ]
    assert last_complete_gameweek(fx) == 1


def test_returns_none_before_any_gameweek_completes():
    fx = [{"event": 1, "team_h": 1, "team_a": 2, "finished_provisional": False}]
    assert last_complete_gameweek(fx) is None


def test_ignores_unscheduled_fixtures_with_null_event():
    fx = [
        {"event": 1, "team_h": 1, "team_a": 2, "finished_provisional": True},
        {"event": None, "team_h": 3, "team_a": 4, "finished_provisional": False},
    ]
    assert last_complete_gameweek(fx) == 1


def test_team_matches_played_counts_only_completed():
    fx = [
        {"event": 1, "team_h": 1, "team_a": 2, "finished_provisional": True},
        {"event": 2, "team_h": 1, "team_a": 3, "finished_provisional": True},
        {"event": 3, "team_h": 1, "team_a": 4, "finished_provisional": False},
    ]
    assert team_matches_played(fx) == {1: 2, 2: 1, 3: 1}


def test_real_payload_labels_a_gameweek(bootstrap, fixtures):
    gw = last_complete_gameweek(fixtures)
    assert gw is None or isinstance(gw, int)
    counts = team_matches_played(fixtures)
    assert all(v >= 0 for v in counts.values())


from scripts.transform import SCHEMA_VERSION, build_payload, build_players

REQUIRED_PLAYER_KEYS = {
    "id", "name", "team", "position", "price", "status", "chance_of_playing", "news",
    "minutes", "starts", "total_points", "bonus", "form", "selected_by",
    "xg90", "xa90", "xgi90", "xgc90", "dc90", "saves90",
    "penalties_order", "direct_freekicks_order", "corners_order",
}


def test_build_players_emits_every_required_key(bootstrap):
    players = build_players(bootstrap)
    assert len(players) == len(bootstrap["elements"])
    assert REQUIRED_PLAYER_KEYS <= set(players[0])


def test_price_is_converted_from_tenths(bootstrap):
    element = bootstrap["elements"][0]
    player = build_players(bootstrap)[0]
    assert player["price"] == element["now_cost"] / 10.0


def test_rate_fields_are_floats_not_strings(bootstrap):
    player = build_players(bootstrap)[0]
    for key in ("xg90", "xa90", "xgi90", "xgc90", "dc90", "saves90", "form"):
        assert isinstance(player[key], float), key


def test_null_news_becomes_empty_string():
    boot = {"elements": [_element(news=None)], "teams": [], "events": []}
    assert build_players(boot)[0]["news"] == ""


def test_build_payload_has_schema_version_and_teams(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="2026-08-31T09:00:00Z")
    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["generated_at"] == "2026-08-31T09:00:00Z"
    assert len(payload["teams"]) == len(bootstrap["teams"])
    assert all({"id", "name", "short_name"} <= set(t) for t in payload["teams"])


def test_build_payload_keeps_only_upcoming_fixtures(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    assert all(f["event"] is not None for f in payload["fixtures"])


def _element(**overrides):
    base = {
        "id": 1, "web_name": "Test", "team": 1, "element_type": 3, "now_cost": 50,
        "status": "a", "chance_of_playing_next_round": None, "news": "",
        "minutes": 90, "starts": 1, "total_points": 5, "bonus": 0,
        "form": "1.0", "selected_by_percent": "1.0",
        "expected_goals_per_90": "0.1", "expected_assists_per_90": "0.2",
        "expected_goal_involvements_per_90": "0.3", "expected_goals_conceded_per_90": "1.0",
        "defensive_contribution_per_90": "5.0", "saves_per_90": "0.0",
        "penalties_order": None, "direct_freekicks_order": None,
        "corners_and_indirect_freekicks_order": None,
    }
    base.update(overrides)
    return base
