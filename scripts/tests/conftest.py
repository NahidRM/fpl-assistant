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
