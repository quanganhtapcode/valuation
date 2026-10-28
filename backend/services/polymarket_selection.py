"""Compact macro event projection, matching the existing frontend contract."""

from __future__ import annotations

import calendar
import json
import math
import re
from datetime import datetime, timezone

MACRO = re.compile(
    r"\b(fed|fomc|federal reserve|interest rate|rate cut|rate hike|central bank|ecb|"
    r"bank of england|bank of japan|boj|cpi|inflation|jobs report|nonfarm|unemployment|"
    r"gdp|recession|treasury|yield|tariff|trade deal|wti|crude oil|brent|gold|silver)\b", re.I,
)
MONTHS = [name.lower() for name in calendar.month_name[1:]]
MONTHLY = re.compile(r"\bin (" + "|".join(MONTHS) + r")\b(?:\s+(\d{4})\b)?", re.I)


def _topic(title):
    for topic, pattern in (
        ("fed", r"fed|fomc|federal reserve|interest rate|rate cut|rate hike"),
        ("treasury-yields", r"treasury|yield"), ("inflation", r"cpi|inflation"),
        ("employment", r"jobs report|nonfarm|unemployment"), ("growth", r"gdp|recession"),
        ("commodities", r"wti|crude oil|brent|oil|gold|silver"), ("trade", r"tariff|trade deal"),
    ):
        if re.search(pattern, title, re.I):
            return topic
    return f"event:{title.lower()}"


def _date(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)
    except (TypeError, ValueError, AttributeError):
        return None


def _number(value, fallback=0):
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def _array(value):
    try:
        items = json.loads(value)
        return [item for item in items if isinstance(item, str)] if isinstance(items, list) else []
    except (TypeError, ValueError):
        return []


def _probability(market):
    labels = _array(market.get("outcomes"))
    prices = _array(market.get("outcomePrices"))
    index = next((i for i, label in enumerate(labels) if label.lower() == "yes"), 0)
    value = _number(prices[index], -1) if index < len(prices) else -1
    return value if 0 <= value <= 1 else -1


def select_polymarket_events(payload: list, now: datetime | None = None) -> list:
    now = now or datetime.now(timezone.utc)

    def not_expired(value):
        date = _date(value)
        return date is None or date > now

    def open_market(market):
        return (market.get("active") and not market.get("closed")
                and market.get("acceptingOrders") is not False and not_expired(market.get("endDate")))

    def period(event):
        match = MONTHLY.search(event.get("title", ""))
        if not match:
            return math.inf
        month = MONTHS.index(match[1].lower())
        reference = _date(event.get("endDate")) or now
        year = int(match[2]) if match[2] else reference.year - int(month > reference.month - 1)
        return year * 12 + month

    def priority(event):
        value = period(event)
        current = now.year * 12 + now.month - 1
        return 0 if math.isinf(value) else 2 if value == current else 1 if value > current else -1

    def decision(event):
        return bool(re.search(r"\b(?:fed|fomc) decision in\b", event["title"], re.I))

    def deadline(event):
        date = _date(event.get("endDate"))
        return date.timestamp() if date else math.inf

    active = [event for event in payload if isinstance(event, dict) and event.get("title")
              and event.get("slug") and not_expired(event.get("endDate"))
              and any(open_market(market) for market in event.get("markets", []))
              and (_topic(event["title"]) not in {"fed", "commodities", "treasury-yields"}
                   or priority(event) >= 0)]
    active.sort(key=lambda event: (_number(event.get("volume")), _number(event.get("volume24hr"))), reverse=True)
    leaders = {}
    for event in active:
        if not MACRO.search(event["title"]):
            continue
        topic = _topic(event["title"])
        current = leaders.get(topic)
        if current and topic == "fed":
            diff = int(decision(event)) - int(decision(current))
            if diff > 0:
                leaders[topic] = event
            if diff:
                continue
            if decision(event):
                diff = deadline(event) - deadline(current)
                if diff < 0:
                    leaders[topic] = event
                if math.isfinite(diff) and diff:
                    continue
        if current and topic == "treasury-yields":
            diff = int(bool(re.search(r"\b10[- ]year\b", event["title"], re.I))) - int(bool(re.search(r"\b10[- ]year\b", current["title"], re.I)))
            if diff > 0:
                leaders[topic] = event
            if diff:
                continue
        if current and topic in {"commodities", "treasury-yields"}:
            diff = priority(event) - priority(current)
            if diff > 0:
                leaders[topic] = event
            if diff:
                continue
            diff = period(event) - period(current)
            if math.isfinite(diff) and diff:
                if diff < 0:
                    leaders[topic] = event
                continue
        if (not current or (topic == "fed" and decision(event) and not decision(current))
                or (decision(event) == decision(current)
                    and _number(event.get("volume")) > _number(current.get("volume")))):
            leaders[topic] = event
    preferred = ["fed", "treasury-yields", "commodities"]
    selected = [leaders[topic] for topic in preferred if topic in leaders]
    selected += sorted((event for topic, event in leaders.items() if topic not in preferred),
                       key=lambda event: _number(event.get("volume")), reverse=True)
    selected += [event for event in active if not MACRO.search(event["title"])]
    result = []
    for event in selected[:3]:
        markets = sorted((market for market in event.get("markets", []) if open_market(market)),
                         key=lambda market: (_probability(market), _number(market.get("volume24hr") or market.get("liquidityNum"))), reverse=True)
        outcomes = []
        for market in markets[:3]:
            labels = _array(market.get("outcomes"))
            index = next((i for i, label in enumerate(labels) if label.lower() == "yes"), 0)
            outcome = {"label": market.get("groupItemTitle") or market.get("question") or (labels[index] if index < len(labels) else "Outcome")}
            probability = _probability(market)
            if probability >= 0:
                outcome["probability"] = probability * 100
            change = market.get("oneDayPriceChange")
            if isinstance(change, (int, float)) and math.isfinite(change):
                outcome["change"] = change * 100
            outcomes.append(outcome)
        projected = {"id": str(event["id"]), "title": event["title"],
                     "url": f"https://polymarket.com/event/{event['slug']}",
                     "outcomes": outcomes, "marketCount": len(markets)}
        projected.update({key: event[key] for key in ("volume", "endDate") if key in event})
        result.append(projected)
    return result
