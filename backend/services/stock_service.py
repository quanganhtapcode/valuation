"""Company list and search backed by the canonical VCI snapshots."""
from pathlib import Path
from typing import Any

from backend.db_path import resolve_vci_company_db_path, resolve_vci_screening_db_path
from backend.sqlite_utils import read_connection, row_dict


class StockService:
    def _companies(
        self, where: str, params: list[Any], limit: int, offset: int = 0,
        exact_ticker: str | None = None,
    ) -> list[dict[str, Any]]:
        # Use a read-only URI for the attachment as well: a missing snapshot
        # must fail rather than create an empty database on disk.
        screening_uri = Path(resolve_vci_screening_db_path()).resolve().as_uri() + '?mode=ro'
        order = (
            "CASE WHEN c.ticker = ? COLLATE NOCASE THEN 0 ELSE 1 END, c.ticker"
            if exact_ticker else "c.ticker"
        )
        order_params = [exact_ticker] if exact_ticker else []
        with read_connection(resolve_vci_company_db_path()) as conn:
            conn.execute('ATTACH DATABASE ? AS scr', (screening_uri,))
            rows = conn.execute(
                f"""
                SELECT c.ticker AS symbol, c.organ_name AS name,
                       COALESCE(sc.exchange, c.floor, 'HOSE') AS exchange,
                       COALESCE(sc.viSector, c.icb_name4, c.icb_name3, '') AS industry
                FROM companies c
                LEFT JOIN scr.screening_data sc ON sc.ticker = c.ticker COLLATE NOCASE
                {where}
                ORDER BY {order} LIMIT ? OFFSET ?
                """,
                [*params, *order_params, limit, offset],
            ).fetchall()
        return [row_dict(row) for row in rows]

    def list_companies(self, exchange: str = '', page: int = 1, limit: int = 200) -> list[dict[str, Any]]:
        limit = min(500, max(10, limit))
        where = "WHERE COALESCE(sc.exchange, c.floor, 'HOSE') = ?" if exchange else ''
        return self._companies(where, [exchange.upper()] if exchange else [], limit, (max(1, page) - 1) * limit)

    def search_stocks(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        query = query.strip()
        if not query:
            return []
        pattern = '%' + query.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%'
        return self._companies(
            "WHERE c.ticker LIKE ? ESCAPE '!' OR c.organ_name LIKE ? ESCAPE '!' "
            "OR c.short_name LIKE ? ESCAPE '!' OR c.en_short_name LIKE ? ESCAPE '!' "
            "OR c.en_organ_name LIKE ? ESCAPE '!'",
            [pattern] * 5, min(50, max(1, limit)), exact_ticker=query,
        )
