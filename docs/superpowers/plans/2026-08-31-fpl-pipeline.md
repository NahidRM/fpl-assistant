# FPL Assistant — Data Pipeline Implementation Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manually-triggered GitHub Action pipeline that fetches FPL data, accumulates per-gameweek snapshots, and commits a validated `data/players.json` for the frontend to consume.

**Architecture:** Four small pure modules plus one entrypoint. `fetch.py` is the only module that touches the network; `transform.py`, `snapshot.py` and `validate.py` are pure functions over plain dicts and are tested without any network. `refresh.py` wires them together and is the only thing the Action runs. All scoring maths is deliberately absent — it lives in the browser (spec §6), so this pipeline emits raw values only.

**Tech Stack:** Python 3.11 standard library only (no dependencies — `urllib.request`, `json`). pytest for tests. GitHub Actions with `workflow_dispatch`.

**Spec:** `docs/superpowers/specs/2026-08-29-fpl-assistant-design.md` — §4, §5, §8, §9.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/fetch.py` | HTTP GET with retry/backoff and a real User-Agent. Nothing else. |
| `scripts/transform.py` | Pure. Bootstrap + fixtures → the `players.json` structure. |
| `scripts/snapshot.py` | Pure. Snapshot payload construction, gameweek labelling, window deltas. |
| `scripts/validate.py` | Pure. The pre-commit validation gate. |
| `scripts/refresh.py` | Entrypoint. Wires the above, writes files. The only script the Action calls. |
| `scripts/record_fixtures.py` | Dev tool. Captures trimmed live payloads into test fixtures. |
| `scripts/tests/` | pytest suite against recorded fixtures. |
| `.github/workflows/refresh-data.yml` | `workflow_dispatch` pipeline. |
| `data/players.json` | Generated output, committed. |
| `data/snapshots/gw{N}.json` | Accumulated per-gameweek snapshots, committed. |

### The `players.json` contract

This is the interface between Plan 1 and Plan 2. Plan 2 depends on these exact key names.

```json
{
  "schema_version": 1,
  "generated_at": "2026-08-31T09:00:00Z",
  "events_finished": 1,
  "current_gameweek": 2,
  "data_checked": false,
  "teams": [{"id": 1, "name": "Arsenal", "short_name": "ARS"}],
  "fixtures": [{"event": 3, "team_h": 1, "team_a": 2,
                "team_h_difficulty": 3, "team_a_difficulty": 2}],
  "team_matches_played": {"1": 2},
  "players": [{
    "id": 165, "name": "Joao Pedro", "team": 1, "position": 4, "price": 7.6,
    "status": "a", "chance_of_playing": null, "news": "",
    "minutes": 180, "starts": 2, "total_points": 15, "bonus": 3,
    "form": 7.5, "selected_by": 68.4,
    "xg90": 0.5, "xa90": 0.3, "xgi90": 0.8,
    "xgc90": 1.2, "dc90": 3.0, "saves90": 0.0,
    "penalties_order": 1, "direct_freekicks_order": null, "corners_order": null,
    "last2": {"minutes": 180, "points": 15, "bonus": 3, "gameweeks": 2},
    "last4": null
  }]
}
```

`last2` / `last4` are `null` when insufficient snapshot history exists. `gameweeks` reports the
*true* span, which may exceed the requested window if a refresh was skipped (spec §5 step 2).

---

## Task 1: Project scaffolding and test harness

**Files:**
- Create: `scripts/__init__.py`, `scripts/tests/__init__.py`, `scripts/tests/conftest.py`
- Create: `scripts/record_fixtures.py`
- Create: `.gitignore`, `pytest.ini`

- [ ] **Step 1: Create the directory skeleton and ignore file**

```bash
mkdir -p scripts/tests/fixtures data/snapshots src
touch scripts/__init__.py scripts/tests/__init__.py
printf '.DS_Store\n__pycache__/\n*.pyc\n.pytest_cache/\n' > .gitignore
printf '[pytest]\ntestpaths = scripts/tests\n' > pytest.ini
```

- [ ] **Step 2: Write the fixture recorder**

Create `scripts/record_fixtures.py`. This is a dev tool, not part of the pipeline. It captures
real payloads trimmed to a manageable size so tests run against genuine API shapes.

```python
"""Dev tool: record trimmed live FPL payloads as test fixtures."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.fetch import fetch_bootstrap, fetch_fixtures

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures")


def main():
    os.makedirs(HERE, exist_ok=True)
    bootstrap = fetch_bootstrap()
    fixtures = fetch_fixtures()

    # Keep every team and event, but only the first 60 players, to keep fixtures small.
    bootstrap["elements"] = bootstrap["elements"][:60]

    with open(os.path.join(HERE, "bootstrap.json"), "w") as fh:
        json.dump(bootstrap, fh)
    with open(os.path.join(HERE, "fixtures.json"), "w") as fh:
        json.dump(fixtures, fh)
    print("recorded %d players, %d fixtures" % (len(bootstrap["elements"]), len(fixtures)))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write conftest.py exposing the fixtures**

Create `scripts/tests/conftest.py`:

```python
import json
import os

import pytest

FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def _load(name):
    with open(os.path.join(FIXTURE_DIR, name)) as fh:
        return json.load(fh)


@pytest.fixture
def bootstrap():
    return _load("bootstrap.json")


@pytest.fixture
def fixtures():
    return _load("fixtures.json")
```

- [ ] **Step 4: Commit the scaffolding**

```bash
git add .gitignore pytest.ini scripts/ data/
git commit -m "chore: scaffold pipeline package and test harness"
```

---

## Task 2: fetch.py — HTTP with retry and backoff

Spec §5 step 1 and §8: GitHub runners are occasionally Cloudflare-blocked by the FPL API, so
this must retry transient failures and fail loudly rather than return partial data.

**Files:**
- Create: `scripts/fetch.py`
- Test: `scripts/tests/test_fetch.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_fetch.py`:

```python
import io
import json
import urllib.error

import pytest

from scripts.fetch import FetchError, fetch_json


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def make_opener(sequence):
    """Returns an opener that yields each item in sequence: an Exception to raise,
    or a dict to return as a JSON body."""
    calls = {"n": 0}

    def opener(req, timeout=None):
        item = sequence[calls["n"]]
        calls["n"] += 1
        if isinstance(item, Exception):
            raise item
        return FakeResponse(json.dumps(item).encode("utf-8"))

    opener.calls = calls
    return opener


def test_returns_parsed_json_on_first_success():
    opener = make_opener([{"ok": True}])
    assert fetch_json("http://x", opener=opener, backoff=0) == {"ok": True}
    assert opener.calls["n"] == 1


def test_retries_transient_403_then_succeeds():
    err = urllib.error.HTTPError("http://x", 403, "Forbidden", {}, None)
    opener = make_opener([err, err, {"ok": True}])
    assert fetch_json("http://x", opener=opener, backoff=0) == {"ok": True}
    assert opener.calls["n"] == 3


def test_raises_immediately_on_non_transient_404():
    err = urllib.error.HTTPError("http://x", 404, "Not Found", {}, None)
    opener = make_opener([err, {"ok": True}])
    with pytest.raises(FetchError):
        fetch_json("http://x", opener=opener, backoff=0)
    assert opener.calls["n"] == 1


def test_raises_after_exhausting_retries():
    err = urllib.error.HTTPError("http://x", 503, "Unavailable", {}, None)
    opener = make_opener([err] * 4)
    with pytest.raises(FetchError):
        fetch_json("http://x", retries=4, opener=opener, backoff=0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_fetch.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.fetch'`

- [ ] **Step 3: Write the implementation**

Create `scripts/fetch.py`:

```python
"""HTTP access to the FPL API. The only module in the pipeline that touches the network."""
import json
import time
import urllib.error
import urllib.request

BASE = "https://fantasy.premierleague.com/api"
USER_AGENT = "Mozilla/5.0 (compatible; fpl-assistant/1.0; +https://github.com/NahidRM/fpl-assistant)"
TRANSIENT_STATUS = {403, 429, 500, 502, 503, 504}


class FetchError(RuntimeError):
    """Raised when a URL cannot be fetched. Callers must not commit partial data."""


def fetch_json(url, *, retries=4, backoff=2.0, opener=urllib.request.urlopen):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code not in TRANSIENT_STATUS:
                raise FetchError("%s returned %s" % (url, exc.code)) from exc
            last = exc
        except Exception as exc:  # network errors, malformed JSON
            last = exc
        if attempt < retries - 1 and backoff:
            time.sleep(backoff * (2 ** attempt))
    raise FetchError("%s failed after %d attempts: %r" % (url, retries, last))


def fetch_bootstrap(**kwargs):
    return fetch_json(BASE + "/bootstrap-static/", **kwargs)


def fetch_fixtures(**kwargs):
    return fetch_json(BASE + "/fixtures/", **kwargs)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_fetch.py -v`
Expected: PASS, 4 passed

- [ ] **Step 5: Record the real fixtures**

Run: `python3 scripts/record_fixtures.py`
Expected: `recorded 60 players, 380 fixtures`

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch.py scripts/tests/test_fetch.py scripts/tests/fixtures/
git commit -m "feat: add FPL API client with retry and backoff"
```

---

## Task 3: transform.py — gameweek labelling and team match counts

Spec D19 and §12.6: `events[].finished` lags the played fixtures by days. This was a **proven
bug**, not a hypothetical one — a refresh keyed on `finished` would write two gameweeks of data
under a GW1 label. Label on `finished_provisional` instead.

**Files:**
- Create: `scripts/transform.py`
- Test: `scripts/tests/test_transform.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_transform.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_transform.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.transform'`

- [ ] **Step 3: Write the implementation**

Create `scripts/transform.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_transform.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/transform.py scripts/tests/test_transform.py
git commit -m "feat: label gameweeks on finished_provisional, not finished"
```

---

## Task 4: transform.py — build the players payload

**Files:**
- Modify: `scripts/transform.py`
- Modify: `scripts/tests/test_transform.py`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/tests/test_transform.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_transform.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_payload'`

- [ ] **Step 3: Write the implementation**

Append to `scripts/transform.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_transform.py -v`
Expected: PASS, 12 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/transform.py scripts/tests/test_transform.py
git commit -m "feat: build players.json payload from bootstrap and fixtures"
```

---

## Task 5: snapshot.py — snapshot payloads and window deltas

Spec §5 steps 2-3 and D20. Snapshots are the raw record; the pipeline diffs them and embeds
the results so the browser makes one fetch rather than N.

**Files:**
- Create: `scripts/snapshot.py`
- Test: `scripts/tests/test_snapshot.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_snapshot.py`:

```python
from scripts.snapshot import build_snapshot, compute_window


def _snapshot(gameweek, players):
    return {"gameweek": gameweek, "data_checked": True, "players": players}


def test_build_snapshot_records_cumulative_totals(bootstrap, fixtures):
    snap = build_snapshot(bootstrap, fixtures)
    assert "gameweek" in snap and "players" in snap
    first = bootstrap["elements"][0]
    entry = snap["players"][str(first["id"])]
    assert entry == {
        "minutes": first["minutes"],
        "total_points": first["total_points"],
        "bonus": first["bonus"],
    }


def test_window_delta_subtracts_baseline():
    current = _snapshot(5, {"1": {"minutes": 450, "total_points": 30, "bonus": 6}})
    history = {3: _snapshot(3, {"1": {"minutes": 270, "total_points": 18, "bonus": 4}})}
    out = compute_window(current, history, 2)
    assert out["1"] == {"minutes": 180, "points": 12, "bonus": 2, "gameweeks": 2}


def test_window_reports_true_span_when_a_refresh_was_skipped():
    current = _snapshot(6, {"1": {"minutes": 540, "total_points": 36, "bonus": 8}})
    history = {2: _snapshot(2, {"1": {"minutes": 180, "total_points": 12, "bonus": 2}})}
    out = compute_window(current, history, 2)
    assert out["1"]["gameweeks"] == 4, "must report the real span, not the requested one"


def test_window_returns_empty_without_enough_history():
    current = _snapshot(2, {"1": {"minutes": 180, "total_points": 12, "bonus": 2}})
    assert compute_window(current, {}, 4) == {}


def test_player_absent_from_baseline_treated_as_zero():
    current = _snapshot(4, {"9": {"minutes": 90, "total_points": 7, "bonus": 1}})
    history = {2: _snapshot(2, {})}
    out = compute_window(current, history, 2)
    assert out["9"] == {"minutes": 90, "points": 7, "bonus": 1, "gameweeks": 2}


def test_window_is_none_safe_when_current_gameweek_unknown():
    current = _snapshot(None, {"1": {"minutes": 0, "total_points": 0, "bonus": 0}})
    assert compute_window(current, {1: _snapshot(1, {})}, 2) == {}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_snapshot.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.snapshot'`

- [ ] **Step 3: Write the implementation**

Create `scripts/snapshot.py`:

```python
"""Per-gameweek snapshots and the window deltas derived from them. Pure functions."""
from scripts.transform import last_complete_gameweek

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
        "players": {
            str(element["id"]): {
                "minutes": element["minutes"],
                "total_points": element["total_points"],
                "bonus": element["bonus"],
            }
            for element in bootstrap["elements"]
        },
    }


def compute_window(current, history, gameweeks):
    """Per-player totals over the trailing `gameweeks` window.

    `history` maps gameweek number to a previously written snapshot. Returns {} when no
    suitable baseline exists. The reported `gameweeks` is the true span between the
    baseline and now, which exceeds the request if a refresh was skipped (spec section 5).
    """
    current_gameweek = current.get("gameweek")
    if current_gameweek is None:
        return {}

    target = current_gameweek - gameweeks
    candidates = sorted(gw for gw in history if gw <= target)
    if not candidates:
        return {}

    baseline_gameweek = candidates[-1]
    baseline = history[baseline_gameweek]["players"]
    span = current_gameweek - baseline_gameweek

    out = {}
    for player_id, totals in current["players"].items():
        before = baseline.get(player_id, ZERO)
        out[player_id] = {
            "minutes": totals["minutes"] - before["minutes"],
            "points": totals["total_points"] - before["total_points"],
            "bonus": totals["bonus"] - before["bonus"],
            "gameweeks": span,
        }
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_snapshot.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/snapshot.py scripts/tests/test_snapshot.py
git commit -m "feat: add gameweek snapshots and window delta computation"
```

---

## Task 6: validate.py — the pre-commit gate

Spec §5 step 5 and §8: a bad refresh must leave the last good data in place rather than
replacing it with garbage.

**Files:**
- Create: `scripts/validate.py`
- Test: `scripts/tests/test_validate.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_validate.py`:

```python
import pytest

from scripts.transform import build_payload
from scripts.validate import ValidationError, validate_payload


def test_real_payload_passes(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    validate_payload(payload, min_players=len(bootstrap["elements"]))


def test_rejects_implausibly_few_players(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    payload["players"] = payload["players"][:3]
    with pytest.raises(ValidationError, match="players"):
        validate_payload(payload, min_players=50)


def test_rejects_missing_required_field(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    del payload["players"][0]["xgi90"]
    with pytest.raises(ValidationError, match="xgi90"):
        validate_payload(payload, min_players=1)


def test_rejects_missing_schema_version(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    del payload["schema_version"]
    with pytest.raises(ValidationError, match="schema_version"):
        validate_payload(payload, min_players=1)


def test_rejects_empty_teams(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    payload["teams"] = []
    with pytest.raises(ValidationError, match="teams"):
        validate_payload(payload, min_players=1)


def test_rejects_all_zero_minutes_as_a_broken_payload(bootstrap, fixtures):
    payload = build_payload(bootstrap, fixtures, generated_at="x")
    for player in payload["players"]:
        player["minutes"] = 0
    with pytest.raises(ValidationError, match="minutes"):
        validate_payload(payload, min_players=1)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_validate.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.validate'`

- [ ] **Step 3: Write the implementation**

Create `scripts/validate.py`:

```python
"""The pre-commit validation gate. Refuses to let a bad refresh overwrite good data."""

REQUIRED_PLAYER_FIELDS = (
    "id", "name", "team", "position", "price", "minutes", "starts",
    "form", "xg90", "xa90", "xgi90", "xgc90", "dc90", "saves90",
)


class ValidationError(RuntimeError):
    """Raised when a payload must not be written."""


def validate_payload(payload, *, min_players=300):
    if "schema_version" not in payload:
        raise ValidationError("payload is missing schema_version")

    if not payload.get("teams"):
        raise ValidationError("payload contains no teams")

    players = payload.get("players") or []
    if len(players) < min_players:
        raise ValidationError(
            "payload contains %d players, expected at least %d" % (len(players), min_players)
        )

    for player in players:
        missing = [field for field in REQUIRED_PLAYER_FIELDS if field not in player]
        if missing:
            raise ValidationError(
                "player %r is missing fields: %s" % (player.get("id"), ", ".join(missing))
            )

    if not any(player["minutes"] > 0 for player in players):
        raise ValidationError("no player has any minutes; payload looks broken")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_validate.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.py scripts/tests/test_validate.py
git commit -m "feat: add validation gate to protect committed data"
```

---

## Task 7: refresh.py — the entrypoint

Spec §5. Snapshot writing is idempotent: re-running mid-week overwrites the same file, and a
snapshot taken before `data_checked` is rewritten on the next run because bonus points are not
yet final.

**Files:**
- Create: `scripts/refresh.py`
- Test: `scripts/tests/test_refresh.py`

- [ ] **Step 1: Write the failing tests**

Create `scripts/tests/test_refresh.py`:

```python
import json
import os

import pytest

from scripts.refresh import load_snapshots, run
from scripts.validate import ValidationError


def test_run_writes_players_and_snapshot(tmp_path, bootstrap, fixtures):
    run(bootstrap, fixtures, data_dir=str(tmp_path), min_players=1,
        generated_at="2026-08-31T09:00:00Z")

    players_path = tmp_path / "players.json"
    assert players_path.exists()
    payload = json.loads(players_path.read_text())
    assert payload["schema_version"] == 1
    assert len(payload["players"]) == len(bootstrap["elements"])


def test_rerunning_overwrites_the_same_snapshot_file(tmp_path, bootstrap, fixtures):
    run(bootstrap, fixtures, data_dir=str(tmp_path), min_players=1, generated_at="a")
    run(bootstrap, fixtures, data_dir=str(tmp_path), min_players=1, generated_at="b")
    snaps = os.listdir(tmp_path / "snapshots")
    assert len(snaps) == 1, "re-running must be idempotent, not accumulate files"


def test_invalid_payload_leaves_existing_file_untouched(tmp_path, bootstrap, fixtures):
    players_path = tmp_path / "players.json"
    players_path.write_text('{"good": "data"}')

    broken = dict(bootstrap)
    broken["teams"] = []

    with pytest.raises(ValidationError):
        run(broken, fixtures, data_dir=str(tmp_path), min_players=1, generated_at="x")

    assert json.loads(players_path.read_text()) == {"good": "data"}


def test_window_deltas_are_attached_to_players(tmp_path, bootstrap, fixtures):
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    first = bootstrap["elements"][0]
    baseline = {
        "gameweek": -10,
        "data_checked": True,
        "players": {str(first["id"]): {"minutes": 0, "total_points": 0, "bonus": 0}},
    }
    (snapshots_dir / "gw-10.json").write_text(json.dumps(baseline))

    run(bootstrap, fixtures, data_dir=str(tmp_path), min_players=1, generated_at="x")
    payload = json.loads((tmp_path / "players.json").read_text())
    target = [p for p in payload["players"] if p["id"] == first["id"]][0]
    assert target["last2"] is not None
    assert target["last2"]["minutes"] == first["minutes"]


def test_load_snapshots_reads_gameweek_files(tmp_path):
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    (snapshots_dir / "gw3.json").write_text(json.dumps({"gameweek": 3, "players": {}}))
    (snapshots_dir / "notes.txt").write_text("ignore me")
    assert list(load_snapshots(str(snapshots_dir))) == [3]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest scripts/tests/test_refresh.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.refresh'`

- [ ] **Step 3: Write the implementation**

Create `scripts/refresh.py`:

```python
"""Pipeline entrypoint. The only script the GitHub Action runs."""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.fetch import fetch_bootstrap, fetch_fixtures
from scripts.snapshot import build_snapshot, compute_window
from scripts.transform import build_payload
from scripts.validate import validate_payload

WINDOWS = {"last2": 2, "last4": 4}


def load_snapshots(snapshots_dir):
    """Maps gameweek number to snapshot payload, for files named gw{N}.json."""
    out = {}
    if not os.path.isdir(snapshots_dir):
        return out
    for name in os.listdir(snapshots_dir):
        if not (name.startswith("gw") and name.endswith(".json")):
            continue
        try:
            gameweek = int(name[2:-5])
        except ValueError:
            continue
        with open(os.path.join(snapshots_dir, name)) as fh:
            out[gameweek] = json.load(fh)
    return out


def _write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))


def run(bootstrap, fixtures, *, data_dir="data", min_players=300, generated_at=None):
    generated_at = generated_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    snapshots_dir = os.path.join(data_dir, "snapshots")

    payload = build_payload(bootstrap, fixtures, generated_at=generated_at)
    snapshot = build_snapshot(bootstrap, fixtures)
    history = load_snapshots(snapshots_dir)

    for key, gameweeks in WINDOWS.items():
        window = compute_window(snapshot, history, gameweeks)
        for player in payload["players"]:
            player[key] = window.get(str(player["id"]))

    # Validate before touching anything on disk.
    validate_payload(payload, min_players=min_players)

    if snapshot["gameweek"] is not None:
        _write_json(os.path.join(snapshots_dir, "gw%d.json" % snapshot["gameweek"]), snapshot)
    _write_json(os.path.join(data_dir, "players.json"), payload)
    return payload


def main():
    payload = run(fetch_bootstrap(), fetch_fixtures())
    print("wrote %d players, gameweek %s, data_checked=%s" % (
        len(payload["players"]), payload["current_gameweek"], payload["data_checked"]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest scripts/tests/test_refresh.py -v`
Expected: PASS, 5 passed

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest -v`
Expected: PASS, 33 passed

- [ ] **Step 6: Run the pipeline against the live API**

Run: `python3 scripts/refresh.py`
Expected: `wrote 622 players, gameweek 2, data_checked=False` (exact numbers vary)

- [ ] **Step 7: Commit**

```bash
git add scripts/refresh.py scripts/tests/test_refresh.py data/
git commit -m "feat: add pipeline entrypoint writing players.json and snapshots"
```

---

## Task 8: The GitHub Action

Spec §4 and §5 step 6. `workflow_dispatch` only — this is the manual refresh button.

**Files:**
- Create: `.github/workflows/refresh-data.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/refresh-data.yml`:

```yaml
name: Refresh FPL data

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Run the test suite
        run: python3 -m pytest -q

      - name: Refresh data
        run: python3 scripts/refresh.py

      - name: Commit updated data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/
          if git diff --staged --quiet; then
            echo "No data changes to commit."
          else
            git commit -m "data: refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            git push
          fi
```

- [ ] **Step 2: Verify the workflow is valid YAML**

PyYAML is a dev-only convenience here; it is never used by the pipeline.

Run:
```bash
python3 -m pip install --quiet pyyaml && python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/refresh-data.yml')); print('valid YAML, jobs:', list(d['jobs']))"
```
Expected: `valid YAML, jobs: ['refresh']`

The workflow's real verification is running it from the Actions tab, which is in **Done when**.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh-data.yml
git commit -m "ci: add manually-triggered data refresh workflow"
```

---

## Task 9: README

Spec §13.6 — the README must **not** claim predictive superiority, because two independent
tests failed to demonstrate it.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with honest limitations section"
```

---

## Done when

- [ ] `python3 -m pytest` passes with 33 tests
- [ ] `python3 scripts/refresh.py` writes `data/players.json` and `data/snapshots/gw{N}.json`
- [ ] `data/players.json` matches the contract at the top of this plan
- [ ] The Action runs green from the Actions tab and commits refreshed data
- [ ] README contains the limitations section unchanged

**Next:** Plan 2 covers the browser scoring model (`src/scoring.js` — shrinkage, negative
binomial, percentiles, weighted sum) and the UI (`src/ui.js`, `src/app.js`, `index.html`).
It depends on the `players.json` contract defined here.
