#!/usr/bin/env python3
"""
Summarize deploy performance gate history from logs/perf/deploy_perf_history.jsonl.

Examples:
  python scripts/summarize_deploy_perf_history.py
  python scripts/summarize_deploy_perf_history.py --last 30
  python scripts/summarize_deploy_perf_history.py --path logs/perf/deploy_perf_history.jsonl
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean


def parse_ts(value: str) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def load_entries(path: Path) -> list[dict]:
    if not path.exists():
        return []

    out: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        text = line.strip()
        if not text:
            continue
        try:
            item = json.loads(text)
            if isinstance(item, dict):
                out.append(item)
        except Exception:
            continue

    out.sort(key=lambda x: parse_ts(str(x.get("timestamp_utc", ""))) or datetime.min.replace(tzinfo=timezone.utc))
    return out


def render(entries: list[dict], last: int) -> int:
    if not entries:
        print("No deploy performance history entries found.")
        return 0

    rows = entries[-last:] if last > 0 else entries
    outcomes = Counter(str(r.get("outcome", "unknown")).lower() for r in rows)

    p95_values = []
    p99_values = []
    err_values = []
    p95_delta_values = []
    p99_delta_values = []

    for row in rows:
        compare = row.get("compare") or {}
        post = compare.get("Post") or compare.get("post") or {}

        if isinstance(post, dict):
            p95 = safe_float(post.get("P95", post.get("p95_ms", None)), default=-1)
            p99 = safe_float(post.get("P99", post.get("p99_ms", None)), default=-1)
            err = safe_float(post.get("ErrorRate", post.get("error_rate_pct", None)), default=-1)
            if p95 >= 0:
                p95_values.append(p95)
            if p99 >= 0:
                p99_values.append(p99)
            if err >= 0:
                err_values.append(err)

        p95_delta = safe_float(compare.get("P95DeltaPct", compare.get("p95_delta_pct", None)), default=10**9)
        p99_delta = safe_float(compare.get("P99DeltaPct", compare.get("p99_delta_pct", None)), default=10**9)
        if p95_delta != 10**9:
            p95_delta_values.append(p95_delta)
        if p99_delta != 10**9:
            p99_delta_values.append(p99_delta)

    print("=== DEPLOY PERF HISTORY SUMMARY ===")
    print(f"Entries analyzed: {len(rows)}")
    print(f"Outcomes: passed={outcomes.get('passed', 0)} failed={outcomes.get('failed', 0)} skipped={outcomes.get('skipped', 0)}")

    if p95_values:
        print(f"Post-deploy p95 avg: {mean(p95_values):.2f}ms")
    if p99_values:
        print(f"Post-deploy p99 avg: {mean(p99_values):.2f}ms")
    if err_values:
        print(f"Post-deploy error rate avg: {mean(err_values):.2f}%")
    if p95_delta_values:
        print(f"p95 delta avg: {mean(p95_delta_values):.2f}%")
    if p99_delta_values:
        print(f"p99 delta avg: {mean(p99_delta_values):.2f}%")

    print("-")
    print("Recent entries:")

    for row in rows[-10:]:
        ts = str(row.get("timestamp_utc", ""))
        outcome = str(row.get("outcome", "unknown")).lower()
        profile = str(row.get("profile", ""))
        compare = row.get("compare") or {}
        post = compare.get("Post") or compare.get("post") or {}

        p95 = safe_float(post.get("P95", post.get("p95_ms", None)), default=-1)
        p99 = safe_float(post.get("P99", post.get("p99_ms", None)), default=-1)
        err = safe_float(post.get("ErrorRate", post.get("error_rate_pct", None)), default=-1)

        p95_txt = f"{p95:.2f}ms" if p95 >= 0 else "n/a"
        p99_txt = f"{p99:.2f}ms" if p99 >= 0 else "n/a"
        err_txt = f"{err:.2f}%" if err >= 0 else "n/a"
        print(f"{ts} | {outcome.upper():7} | profile={profile:10} | p95={p95_txt:10} p99={p99_txt:10} err={err_txt}")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize deploy performance gate history")
    parser.add_argument("--path", default="logs/perf/deploy_perf_history.jsonl", help="Path to history file")
    parser.add_argument("--last", type=int, default=50, help="Number of latest entries to analyze")
    args = parser.parse_args()

    path = Path(args.path)
    entries = load_entries(path)
    return render(entries, max(1, int(args.last)))


if __name__ == "__main__":
    raise SystemExit(main())
