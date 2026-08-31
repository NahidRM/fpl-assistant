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
