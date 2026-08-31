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
