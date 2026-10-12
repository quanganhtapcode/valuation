"""Atomic publication and serving of the shared hourly Fmarket listing."""
from __future__ import annotations
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data/cache/funds.json"
NUMERIC = {"nav", "management_fee", "fund_id_fmarket", "vsd_fee_id"}


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def publish_snapshot(records, path=None):
    if not records:
        raise ValueError("Refusing to publish an empty fund snapshot")
    rows = []
    for record in records:
        row = {key: number(value) if key in NUMERIC or key.startswith("nav_change_") else value for key, value in record.items()}
        if not row.get("short_name") or row.get("nav") is None or row["nav"] <= 0:
            raise ValueError("Fund snapshot contains an invalid NAV")
        rows.append(row)
    snapshot = {"success": True, "data": rows, "count": len(rows), "source": "Fmarket",
                "source_url": "https://fmarket.vn/", "fetched_at": datetime.now(timezone.utc).isoformat()}
    target = Path(path or os.getenv("FUNDS_SNAPSHOT_PATH", str(DEFAULT_PATH)))
    target.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, delete=False, encoding="utf-8") as handle:
            name = handle.name
            json.dump(snapshot, handle, ensure_ascii=False, allow_nan=False)
        os.replace(name, target)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
    return snapshot


def read_snapshot():
    target = Path(os.getenv("FUNDS_SNAPSHOT_PATH", str(DEFAULT_PATH)))
    try:
        result = json.loads(target.read_text())
        if not result.get("success") or not result.get("data"):
            raise ValueError("Empty snapshot")
        stamp = datetime.fromisoformat(result["fetched_at"])
        result["stale"] = (datetime.now(timezone.utc) - stamp).total_seconds() > 7200
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return {"success": False, "data": [], "count": 0, "error": "Fund prices temporarily unavailable"}
