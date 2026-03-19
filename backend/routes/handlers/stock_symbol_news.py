from __future__ import annotations

from typing import Any

from backend.services.vci_news_sqlite import default_news_db_path, query_news_for_symbol


def get_symbol_news_from_sqlite(*, symbol: str, limit: int = 15) -> list[dict[str, Any]]:
    """Return raw items for /api/news/<symbol> from the VCI AI SQLite cache.

    We keep the raw upstream JSON (as stored in SQLite) to preserve maximum
    compatibility with existing frontend mappings.
    """
    db_path = default_news_db_path()
    return query_news_for_symbol(db_path, symbol, limit=limit) or []
