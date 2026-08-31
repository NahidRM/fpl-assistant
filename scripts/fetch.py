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
