"""Small opt-in response projections; preserve legacy payloads by default."""

from __future__ import annotations

HISTORY_COLUMNS = ["date", "open", "high", "low", "close", "volume"]
FIELD_COLUMNS = {"field", "level", "titleVi", "titleEn", "fullTitleVi", "fullTitleEn"}
FIELD_SECTIONS = {"BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW", "NOTE"}


def column_history(payload: dict) -> dict:
    """Name columns once; keep financial values and missing values unchanged."""
    return {**payload, "columns": HISTORY_COLUMNS,
            "data": [[row.get(column) for column in HISTORY_COLUMNS] for row in payload["data"]]}


def project_field_codes(payload: dict, sections: str | None, compact: bool, fields: str | None) -> dict:
    selected = [section.strip().upper() for section in sections.split(",")] if sections else list(payload)
    if not selected or any(section not in FIELD_SECTIONS for section in selected):
        raise ValueError("section must be BALANCE_SHEET, INCOME_STATEMENT, CASH_FLOW or NOTE")
    selected = list(dict.fromkeys(selected))
    allowed = {field.strip() for field in fields.split(",")} if fields else FIELD_COLUMNS
    if fields and (not allowed or not allowed <= FIELD_COLUMNS):
        raise ValueError("fields must contain supported field-code labels")
    if compact or fields:
        def project(row):
            result = {key: value for key, value in row.items() if key in allowed}
            for language in ("Vi", "En"):
                short, full = f"title{language}", f"fullTitle{language}"
                if compact and short in result and result.get(full) == result[short]:
                    result.pop(full, None)
            return result
        return {section: [project(row) for row in payload.get(section, [])] for section in selected}
    return {section: payload.get(section, []) for section in selected}


def compact_technical(payload: dict) -> dict:
    return {key: payload[key] for key in ("success", "symbol", "timeframe", "fetched_at_utc", "data")
            if key in payload}
