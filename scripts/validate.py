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
