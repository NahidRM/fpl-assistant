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
