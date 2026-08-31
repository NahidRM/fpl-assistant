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
