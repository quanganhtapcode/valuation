#!/usr/bin/env python3
"""Send one Telegram alert for financial statements newly published in SQLite."""

from __future__ import annotations

import argparse
import html
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FINANCIALS_DB = PROJECT_ROOT / "data" / "sqlite" / "vci_financials.sqlite"
COMPANY_DB = PROJECT_ROOT / "data" / "sqlite" / "vci_company.sqlite"
STATE_FILE = PROJECT_ROOT / "runtime" / "earnings_telegram_state.json"
TELEGRAM_ENV_FILE = PROJECT_ROOT / ".telegram_uptime.env"
# Leave room for Telegram's UTF-16 accounting and future header changes.
TELEGRAM_SAFE_LENGTH = 3800
PUBLICATION_OVERLAP = timedelta(days=1)


def telegram_config() -> tuple[str | None, str | None]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if token and chat_id:
        return token, chat_id
    try:
        for line in TELEGRAM_ENV_FILE.read_text().splitlines():
            key, _, value = line.partition("=")
            if key == "TELEGRAM_BOT_TOKEN":
                token = token or value.strip()
            elif key == "TELEGRAM_CHAT_ID":
                chat_id = chat_id or value.strip()
    except FileNotFoundError:
        pass
    return token, chat_id


def growth(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100


def load_releases(
    *,
    year: int | None = None,
    quarter: int | None = None,
    published_since: datetime | None = None,
) -> list[dict[str, Any]]:
    if (year is None) != (quarter is None):
        raise ValueError("year and quarter must be provided together")

    filters = [
        "p.section = 'INCOME_STATEMENT'",
        "p.period_kind = 'QUARTER'",
        "p.quarter_report BETWEEN 1 AND 4",
    ]
    parameters: list[Any] = []
    if year is not None and quarter is not None:
        filters.extend(["p.year_report = ?", "p.quarter_report = ?"])
        parameters.extend([year, quarter])
    if published_since is not None:
        # Upstream publication timestamps are commonly stored at midnight.
        filters.append("p.public_date >= ?")
        parameters.append(published_since.strftime("%Y-%m-%dT00:00:00"))

    conn = sqlite3.connect(
        f"file:{FINANCIALS_DB}?mode=ro&immutable=1",
        uri=True,
    )
    try:
        conn.execute(
            "ATTACH DATABASE ? AS company",
            (f"file:{COMPANY_DB}?mode=ro&immutable=1",),
        )
        rows = conn.execute(
            f"""
            SELECT p.ticker, p.year_report, p.quarter_report,
                   COALESCE(c.short_name, c.organ_name, p.ticker) AS name,
                   p.public_date, cur.isa1 AS revenue, prev.isa1 AS revenue_previous,
                   cur.isa22 AS net_income, prev.isa22 AS net_income_previous
            FROM statement_periods p
            JOIN income_statement cur
              ON cur.ticker = p.ticker AND cur.period_kind = p.period_kind
             AND cur.year_report = p.year_report AND cur.quarter_report = p.quarter_report
            LEFT JOIN income_statement prev
              ON prev.ticker = p.ticker AND prev.period_kind = 'QUARTER'
             AND prev.year_report = p.year_report - 1
             AND prev.quarter_report = p.quarter_report
            LEFT JOIN company.companies c ON c.ticker = p.ticker
            WHERE {' AND '.join(filters)}
            ORDER BY p.year_report, p.quarter_report, p.public_date, p.ticker
            """,
            parameters,
        ).fetchall()
        return [
            {
                "ticker": row[0], "year": int(row[1]), "quarter": int(row[2]),
                "name": row[3], "public_date": row[4] or "",
                "revenue": row[5], "revenue_yoy": growth(row[5], row[6]),
                "net_income": row[7], "net_income_yoy": growth(row[7], row[8]),
            }
            for row in rows
        ]
    finally:
        conn.close()


def load_state() -> tuple[set[str], datetime | None]:
    try:
        data = json.loads(STATE_FILE.read_text())
        sent = set(str(item) for item in data.get("sent", []))
        raw_updated_at = data.get("updated_at")
        updated_at = (
            datetime.fromisoformat(str(raw_updated_at).replace("Z", "+00:00"))
            if raw_updated_at
            else None
        )
        if updated_at is not None and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        return sent, updated_at
    except (AttributeError, FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
        return set(), None


def save_state(sent: set[str], updated_at: datetime) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"sent": sorted(sent), "updated_at": updated_at.isoformat()}))
    temporary.replace(STATE_FILE)


def fmt_billion(value: float | None) -> str:
    return "N/A" if value is None else f"{value / 1_000_000_000:,.1f} tỷ"


def fmt_growth(value: float | None) -> str:
    return "N/A" if value is None else f"{value:+.1f}% YoY"


def release_key(item: dict[str, Any]) -> str:
    return (
        f"{item['year']}-Q{item['quarter']}-{item['ticker']}-{item['public_date']}"
    )


def release_block(item: dict[str, Any]) -> str:
    ticker = html.escape(str(item["ticker"]), quote=False)
    name = html.escape(str(item["name"]), quote=False)
    public_date = html.escape(str(item["public_date"])[:10], quote=False)
    return "\n".join([
        f"<b>{ticker}</b> — {name} ({public_date})",
        f"DT: {fmt_billion(item['revenue'])} ({fmt_growth(item['revenue_yoy'])})",
        f"LNST: {fmt_billion(item['net_income'])} ({fmt_growth(item['net_income_yoy'])})",
    ])


def message_batches(
    year: int,
    quarter: int,
    releases: list[dict[str, Any]],
) -> list[tuple[str, list[dict[str, Any]]]]:
    batches: list[tuple[str, list[dict[str, Any]]]] = []
    current: list[dict[str, Any]] = []

    def render(items: list[dict[str, Any]]) -> str:
        header = f"📊 BCTC Q{quarter}/{year}: {len(items)} mã mới công bố"
        return "\n\n".join([header, *(release_block(item) for item in items)])

    for item in releases:
        candidate = [*current, item]
        if current and len(render(candidate)) > TELEGRAM_SAFE_LENGTH:
            batches.append((render(current), current))
            current = [item]
        else:
            current = candidate
    if current:
        batches.append((render(current), current))
    return batches


def send_telegram(token: str, chat_id: str, text: str) -> None:
    payload = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=payload,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Telegram request failed: {exc}") from exc
    if not result.get("ok"):
        raise RuntimeError("Telegram rejected the message")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int)
    parser.add_argument("--quarter", type=int, choices=(1, 2, 3, 4))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if (args.year is None) != (args.quarter is None):
        parser.error("--year and --quarter must be provided together")

    checked_at = datetime.now(timezone.utc)
    sent, last_checked_at = load_state()
    explicit_period = args.year is not None and args.quarter is not None

    if explicit_period:
        releases = load_releases(year=args.year, quarter=args.quarter)
    elif last_checked_at is None:
        # Establish a baseline without broadcasting every report already in the DB.
        baseline = load_releases(published_since=checked_at - PUBLICATION_OVERLAP)
        sent.update(release_key(item) for item in baseline)
        save_state(sent, checked_at)
        print(f"Initialized state with {len(baseline)} recent release(s); no messages sent")
        return 0
    else:
        releases = load_releases(
            published_since=last_checked_at - PUBLICATION_OVERLAP,
        )

    new_releases = [item for item in releases if release_key(item) not in sent]
    if not new_releases:
        if not explicit_period:
            save_state(sent, checked_at)
        print("No new financial-statement releases")
        return 0

    grouped: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for item in new_releases:
        grouped.setdefault((item["year"], item["quarter"]), []).append(item)
    batches = [
        batch
        for (year, quarter), items in sorted(grouped.items())
        for batch in message_batches(year, quarter, items)
    ]
    if args.dry_run:
        print("\n\n--- next Telegram message ---\n\n".join(text for text, _ in batches))
        return 0
    token, chat_id = telegram_config()
    if not token or not chat_id:
        print("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID", file=sys.stderr)
        return 1
    checkpoint = last_checked_at or checked_at
    sent_count = 0
    for text, items in batches:
        send_telegram(token, chat_id, text)
        sent.update(release_key(item) for item in items)
        sent_count += len(items)
        # Persist each successful batch. If a later send fails, only unsent items
        # remain pending on the next timer run.
        save_state(sent, checkpoint)
    save_state(sent, checked_at if not explicit_period else checkpoint)
    print(f"Sent {sent_count} release(s) in {len(batches)} message(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
