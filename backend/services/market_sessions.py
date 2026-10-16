"""Session labels for snapshots; stale data must never masquerade as today's quote."""
from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7))


def expected_session_date(now: datetime | None = None) -> str:
    local = (now or datetime.now(timezone.utc)).astimezone(VN_TZ)
    if local.hour < 9:
        local -= timedelta(days=1)
    while local.weekday() >= 5:
        local -= timedelta(days=1)
    # A holiday without a matching snapshot remains unavailable, rather than
    # silently re-labelling an older session as today's market movement.
    return local.date().isoformat()
