"""Pure transforms from raw FPL payloads into the players.json structure.

No network access and no scoring maths: all model computation happens in the browser
(spec section 6), so this module emits raw values only.
"""

SCHEMA_VERSION = 1


def last_complete_gameweek(fixtures):
    """Highest gameweek whose fixtures are all finished_provisional, else None.

    Deliberately not events[].finished, which lags the played fixtures by days while
    bonus points settle (spec D19).
    """
    by_gameweek = {}
    for fixture in fixtures:
        event = fixture.get("event")
        if event is None:
            continue
        by_gameweek.setdefault(event, []).append(fixture)

    complete = [
        gameweek
        for gameweek, group in by_gameweek.items()
        if all(f.get("finished_provisional") for f in group)
    ]
    return max(complete) if complete else None


def team_matches_played(fixtures):
    """Completed matches per team id."""
    counts = {}
    for fixture in fixtures:
        if not fixture.get("finished_provisional"):
            continue
        for side in ("team_h", "team_a"):
            counts[fixture[side]] = counts.get(fixture[side], 0) + 1
    return counts


def build_players(bootstrap):
    """One flat record per player. Raw values only; no normalization."""
    players = []
    for element in bootstrap["elements"]:
        players.append({
            "id": element["id"],
            "name": element["web_name"],
            "team": element["team"],
            "position": element["element_type"],
            "price": element["now_cost"] / 10.0,
            "status": element["status"],
            "chance_of_playing": element["chance_of_playing_next_round"],
            "news": element["news"] or "",
            "minutes": element["minutes"],
            "starts": element["starts"],
            "total_points": element["total_points"],
            "bonus": element["bonus"],
            "form": float(element["form"]),
            "selected_by": float(element["selected_by_percent"]),
            "xg90": float(element["expected_goals_per_90"]),
            "xa90": float(element["expected_assists_per_90"]),
            "xgi90": float(element["expected_goal_involvements_per_90"]),
            "xgc90": float(element["expected_goals_conceded_per_90"]),
            "dc90": float(element["defensive_contribution_per_90"]),
            "saves90": float(element["saves_per_90"]),
            "penalties_order": element["penalties_order"],
            "direct_freekicks_order": element["direct_freekicks_order"],
            "corners_order": element["corners_and_indirect_freekicks_order"],
        })
    return players


def build_payload(bootstrap, fixtures, *, generated_at):
    """The complete players.json structure, before window deltas are attached."""
    current_gameweek = last_complete_gameweek(fixtures)
    events = {event["id"]: event for event in bootstrap.get("events", [])}
    current_event = events.get(current_gameweek) or {}

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "events_finished": sum(1 for e in bootstrap.get("events", []) if e.get("finished")),
        "current_gameweek": current_gameweek,
        "data_checked": bool(current_event.get("data_checked")),
        "teams": [
            {"id": t["id"], "name": t["name"], "short_name": t["short_name"]}
            for t in bootstrap.get("teams", [])
        ],
        "fixtures": [
            {
                "event": f["event"],
                "team_h": f["team_h"],
                "team_a": f["team_a"],
                "team_h_difficulty": f["team_h_difficulty"],
                "team_a_difficulty": f["team_a_difficulty"],
                "finished_provisional": bool(f.get("finished_provisional")),
            }
            for f in fixtures
            if f.get("event") is not None
        ],
        "team_matches_played": {str(k): v for k, v in team_matches_played(fixtures).items()},
        "players": build_players(bootstrap),
    }
