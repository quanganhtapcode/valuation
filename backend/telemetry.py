from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


_LOCK = threading.RLock()
_WINDOW_SIZE = 500
_MAX_ROUTES = 120


class _LatencyBucket:
    __slots__ = ("samples", "last_seen")

    def __init__(self) -> None:
        self.samples = deque(maxlen=_WINDOW_SIZE)
        self.last_seen = 0.0


_ROUTE_LATENCY: dict[str, _LatencyBucket] = {}


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]

    rank = (len(sorted_values) - 1) * p
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    frac = rank - low
    return sorted_values[low] * (1.0 - frac) + sorted_values[high] * frac


def record_request_latency(route_key: str, duration_ms: float) -> None:
    key = str(route_key or "unknown")[:180]
    ms = max(0.0, float(duration_ms or 0.0))
    now = time.time()

    with _LOCK:
        bucket = _ROUTE_LATENCY.get(key)
        if bucket is None:
            if len(_ROUTE_LATENCY) >= _MAX_ROUTES:
                oldest_key = min(_ROUTE_LATENCY.items(), key=lambda item: item[1].last_seen)[0]
                _ROUTE_LATENCY.pop(oldest_key, None)
            bucket = _LatencyBucket()
            _ROUTE_LATENCY[key] = bucket

        bucket.samples.append(ms)
        bucket.last_seen = now


def get_latency_metrics(top_n: int = 20) -> dict:
    with _LOCK:
        route_items = list(_ROUTE_LATENCY.items())

    details = []
    for route, bucket in route_items:
        values = list(bucket.samples)
        if not values:
            continue
        sorted_values = sorted(values)
        details.append(
            {
                "route": route,
                "count": len(values),
                "avg_ms": round(sum(values) / len(values), 2),
                "p50_ms": round(_percentile(sorted_values, 0.50), 2),
                "p95_ms": round(_percentile(sorted_values, 0.95), 2),
                "p99_ms": round(_percentile(sorted_values, 0.99), 2),
                "max_ms": round(max(values), 2),
            }
        )

    details.sort(key=lambda item: item["p95_ms"], reverse=True)
    top_n = max(1, int(top_n or 20))
    top = details[:top_n]

    all_samples = []
    for item in details:
        route = item["route"]
        bucket = _ROUTE_LATENCY.get(route)
        if bucket:
            all_samples.extend(bucket.samples)

    sorted_all = sorted(all_samples)
    summary = {
        "sample_count": len(all_samples),
        "routes_tracked": len(details),
        "p50_ms": round(_percentile(sorted_all, 0.50), 2) if sorted_all else 0.0,
        "p95_ms": round(_percentile(sorted_all, 0.95), 2) if sorted_all else 0.0,
        "p99_ms": round(_percentile(sorted_all, 0.99), 2) if sorted_all else 0.0,
    }

    status = "ok" if (summary["p95_ms"] <= 250 and summary["p99_ms"] <= 500) else "warn"
    return {
        "status": status,
        "summary": summary,
        "routes": top,
    }
