"""The pre-commit validation gate. Refuses to let a bad refresh overwrite good data."""
import math

REQUIRED_PLAYER_FIELDS = (
    "id", "name", "team", "position", "price", "minutes", "starts",
    "form", "xg90", "xa90", "xgi90", "xgc90", "dc90", "saves90",
)

# Per-90 rate fields that must be finite and non-negative.  A NaN in any of these
# propagates through percentileRanks and corrupts every score on the board — the
# JS sort comparator returns undefined order when scores are NaN.
_RATE_FIELDS = ("xg90", "xa90", "xgi90", "xgc90", "dc90", "saves90")
# These numeric fields must also be finite (inf/NaN both break the board).
_FINITE_FIELDS = ("price", "form", "minutes", "starts") + _RATE_FIELDS


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
        pid = player.get("id")

        missing = [field for field in REQUIRED_PLAYER_FIELDS if field not in player]
        if missing:
            raise ValidationError(
                "player %r is missing fields: %s" % (pid, ", ".join(missing))
            )

        for field in _FINITE_FIELDS:
            val = player[field]
            if not isinstance(val, (int, float)) or not math.isfinite(val):
                raise ValidationError(
                    "player %r field %r is not finite: %r (nan/inf corrupt the board)"
                    % (pid, field, val)
                )

        for field in _RATE_FIELDS:
            if player[field] < 0:
                raise ValidationError(
                    "player %r field %r is negative (%r); physically impossible"
                    % (pid, field, player[field])
                )

    if not any(player["minutes"] > 0 for player in players):
        raise ValidationError("no player has any minutes; payload looks broken")
