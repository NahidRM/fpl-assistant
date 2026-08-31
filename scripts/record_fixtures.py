"""Dev tool: record trimmed live FPL payloads as test fixtures.

Not part of the pipeline. Re-run this when the API shape changes or when the
recorded season state needs refreshing.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.fetch import fetch_bootstrap, fetch_fixtures

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests", "fixtures")
PLAYER_SAMPLE = 60


def main():
    os.makedirs(HERE, exist_ok=True)
    bootstrap = fetch_bootstrap()
    fixtures = fetch_fixtures()

    # Keep every team and event, but trim players to keep the fixture small.
    bootstrap["elements"] = bootstrap["elements"][:PLAYER_SAMPLE]

    with open(os.path.join(HERE, "bootstrap.json"), "w") as fh:
        json.dump(bootstrap, fh)
    with open(os.path.join(HERE, "fixtures.json"), "w") as fh:
        json.dump(fixtures, fh)
    print("recorded %d players, %d fixtures" % (len(bootstrap["elements"]), len(fixtures)))


if __name__ == "__main__":
    main()
