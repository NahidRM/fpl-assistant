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


def test_write_is_atomic_so_crash_mid_write_does_not_corrupt_existing_file(tmp_path):
    """Non-atomic write (open+write+close) leaves a truncated, unparseable file if the
    process dies mid-write.  The fix is write-to-temp then os.replace, so the destination
    file is either the old version or the complete new version — never a partial.

    We test _write_json directly so the crash clearly targets the players.json write
    rather than an earlier snapshot write.
    """
    import unittest.mock as mock
    from scripts.refresh import _write_json

    dest = tmp_path / "players.json"
    good_content = '{"previous": "good run"}'
    dest.write_text(good_content)

    def crashing_dump(obj, fh, **kw):
        fh.write('{"partial":true,')   # partial content, then die
        raise OSError("simulated disk-full or process kill mid-write")

    with mock.patch("scripts.refresh.json.dump", side_effect=crashing_dump):
        try:
            _write_json(str(dest), {"players": list(range(600))})
        except (OSError, Exception):
            pass

    content = dest.read_text()
    try:
        json.loads(content)
        parseable = True
    except json.JSONDecodeError:
        parseable = False

    assert parseable and content == good_content, (
        f"Crash mid-write left players.json in a bad state: {content[:80]!r}. "
        "Fix: write to a temp file then os.replace() so the destination is "
        "always the old complete version or the new complete version."
    )
