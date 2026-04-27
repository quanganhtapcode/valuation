from __future__ import annotations

import logging
from typing import Any

from flask import Blueprint, jsonify, request

from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _normalize_key(key: str) -> str:
    return str(key).strip().lower()


def _pick_metric(
    data_dict: dict[str, Any],
    include_hints: list[str],
    reject_hints: list[str] | None = None,
    prefer_larger_abs: bool = False,
) -> float | None:
    reject_hints = reject_hints or []

    norm_items = [(_normalize_key(k), v) for k, v in data_dict.items()]

    for hint in include_hints:
        hint_n = _normalize_key(hint)
        for key_n, value in norm_items:
            if key_n == hint_n:
                metric = _safe_float(value)
                if metric is not None:
                    return metric

    candidates: list[float] = []
    for key_n, value in norm_items:
        if any(token in key_n for token in reject_hints):
            continue
        if any(_normalize_key(hint) in key_n for hint in include_hints):
            metric = _safe_float(value)
            if metric is not None:
                candidates.append(metric)

    if not candidates:
        return None
    if prefer_larger_abs:
        return max(candidates, key=lambda x: abs(x))
    return candidates[0]


def _parse_income_statement(raw: dict[str, Any]) -> dict[str, float | None]:
    revenue = _pick_metric(
        raw,
        [
            "net_revenue",
            "revenue",
            "doanh thu thuần",
            "net sales",
            "sales",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    cogs = _pick_metric(
        raw,
        [
            "cost_of_goods_sold",
            "cost of goods sold",
            "giá vốn hàng bán",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    gross_profit = _pick_metric(
        raw,
        ["gross_profit", "gross profit", "lãi gộp", "gross income"],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    selling_expense = _pick_metric(
        raw,
        [
            "selling_expense",
            "selling expenses",
            "chi phí bán hàng",
            "selling and marketing",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    admin_expense = _pick_metric(
        raw,
        [
            "general_admin_expense",
            "general and administrative",
            "administrative expenses",
            "chi phí quản lý doanh nghiệp",
            "chi phí qldn",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    operating_profit = _pick_metric(
        raw,
        [
            "operating_profit",
            "operating income",
            "operating profit",
            "ebit",
            "lợi nhuận thuần từ hoạt động kinh doanh",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    other_income = _pick_metric(
        raw,
        [
            "other_income",
            "financial income",
            "lợi nhuận khác",
            "doanh thu tài chính",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )
    other_expense = _pick_metric(
        raw,
        [
            "other_expense",
            "financial expense",
            "chi phí tài chính",
            "chi phí khác",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    profit_before_tax = _pick_metric(
        raw,
        [
            "profit_before_tax",
            "profit before tax",
            "lợi nhuận trước thuế",
            "pre-tax profit",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    tax = _pick_metric(
        raw,
        [
            "income_tax",
            "tax expense",
            "thuế thu nhập doanh nghiệp",
            "income tax expense",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    net_profit = _pick_metric(
        raw,
        [
            "net_profit_parent_company",
            "net_profit",
            "net income",
            "lợi nhuận sau thuế",
            "attributed to owners of parent",
        ],
        reject_hints=["yoy", "%", "growth", "margin"],
        prefer_larger_abs=True,
    )

    if gross_profit is None and revenue is not None and cogs is not None:
        gross_profit = revenue - abs(cogs)

    sell_admin = None
    if selling_expense is not None or admin_expense is not None:
        sell_admin = (selling_expense or 0.0) + (admin_expense or 0.0)

    other_income_expense = None
    if other_income is not None or other_expense is not None:
        other_income_expense = (other_income or 0.0) - abs(other_expense or 0.0)

    if profit_before_tax is None and operating_profit is not None and other_income_expense is not None:
        profit_before_tax = operating_profit + other_income_expense

    if net_profit is None and profit_before_tax is not None and tax is not None:
        net_profit = profit_before_tax - abs(tax)

    net_margin = None
    if revenue not in (None, 0) and net_profit is not None:
        net_margin = (net_profit / revenue) * 100

    return {
        "revenue": revenue,
        "cogs": cogs,
        "gross_profit": gross_profit,
        "selling_admin_expense": sell_admin,
        "operating_profit": operating_profit,
        "other_income_expense": other_income_expense,
        "profit_before_tax": profit_before_tax,
        "tax": tax,
        "net_profit": net_profit,
        "net_margin": net_margin,
    }


def _parse_balance_statement(raw: dict[str, Any]) -> dict[str, float | None]:
    total_assets = _pick_metric(
        raw,
        ["total_assets", "total assets", "tổng tài sản"],
        reject_hints=["%", "yoy", "growth"],
        prefer_larger_abs=True,
    )
    total_equity = _pick_metric(
        raw,
        ["owner's equity", "owners_equity", "equity", "vốn chủ sở hữu"],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )

    total_liabilities = _pick_metric(
        raw,
        ["total_liabilities", "total liabilities", "nợ phải trả"],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )

    total_debt = _pick_metric(
        raw,
        [
            "total_debt",
            "financial debt",
            "interest bearing debt",
            "nợ vay",
            "borrowings",
        ],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )

    if total_debt is None:
        total_debt = total_liabilities
    if total_liabilities is None and total_assets is not None and total_equity is not None:
        total_liabilities = total_assets - total_equity

    current_assets = _pick_metric(
        raw,
        ["current_assets", "current assets", "tài sản ngắn hạn"],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )
    current_liabilities = _pick_metric(
        raw,
        ["current_liabilities", "current liabilities", "nợ ngắn hạn"],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )

    non_current_assets = _pick_metric(
        raw,
        [
            "non_current_assets",
            "long_term_assets",
            "non-current assets",
            "tài sản dài hạn",
        ],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )
    non_current_liabilities = _pick_metric(
        raw,
        [
            "non_current_liabilities",
            "long_term_liabilities",
            "non-current liabilities",
            "nợ dài hạn",
        ],
        reject_hints=["%", "yoy", "growth", "ratio"],
        prefer_larger_abs=True,
    )

    if non_current_assets is None and total_assets is not None and current_assets is not None:
        non_current_assets = total_assets - current_assets
    if non_current_liabilities is None and total_liabilities is not None and current_liabilities is not None:
        non_current_liabilities = total_liabilities - current_liabilities

    debt_to_equity = None
    if total_debt is not None and total_equity not in (None, 0):
        debt_to_equity = (total_debt / total_equity) * 100

    return {
        "total_assets": total_assets,
        "total_equity": total_equity,
        "total_liabilities": total_liabilities,
        "total_debt": total_debt,
        "current_assets": current_assets,
        "current_liabilities": current_liabilities,
        "non_current_assets": non_current_assets,
        "non_current_liabilities": non_current_liabilities,
        "debt_to_equity_pct": debt_to_equity,
    }


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/financial-dashboard")
    def api_financial_dashboard(symbol: str):
        """Get dashboard-style financial chart data from SQLite statements."""
        is_valid, result = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": result}), 400
        symbol = result

        period = request.args.get("period", "year")
        period = "quarter" if period == "quarter" else "year"
        limit = int(request.args.get("limit", "8"))
        limit = max(4, min(limit, 16))

        try:
            provider = get_provider()
            income_rows = provider.vci.get_financial_statement(symbol, "income", limit=limit * 4) or []
            balance_rows = provider.vci.get_financial_statement(symbol, "balance", limit=limit * 4) or []
            # VCI format uses year_report/quarter_report as period keys and flat field codes as data
            income_rows = [{"year": r.get("year_report"), "quarter": r.get("quarter_report") or 0, "data": r} for r in income_rows]
            balance_rows = [{"year": r.get("year_report"), "quarter": r.get("quarter_report") or 0, "data": r} for r in balance_rows]

            income_map = {
                (int(item["year"]), int(item.get("quarter") or 0)): _parse_income_statement(item.get("data") or {})
                for item in income_rows
            }
            balance_map = {
                (int(item["year"]), int(item.get("quarter") or 0)): _parse_balance_statement(item.get("data") or {})
                for item in balance_rows
            }

            all_periods = sorted(set(income_map.keys()) | set(balance_map.keys()))
            if not all_periods:
                return jsonify({"success": True, "data": {"series": [], "waterfall": None, "position": None}})

            selected_periods = all_periods[-limit:]

            series: list[dict[str, Any]] = []
            for year, quarter in selected_periods:
                inc = income_map.get((year, quarter), {})
                bal = balance_map.get((year, quarter), {})
                label = f"{year}" if period == "year" else f"Q{quarter} '{str(year)[-2:]}"
                series.append(
                    {
                        "period": label,
                        "year": year,
                        "quarter": quarter,
                        "revenue": inc.get("revenue"),
                        "net_profit": inc.get("net_profit"),
                        "net_margin": inc.get("net_margin"),
                        "total_debt": bal.get("total_debt"),
                        "total_equity": bal.get("total_equity"),
                        "debt_to_equity_pct": bal.get("debt_to_equity_pct"),
                    }
                )

            latest_key = selected_periods[-1]
            latest_income = income_map.get(latest_key, {})
            latest_balance = balance_map.get(latest_key, {})

            latest_year, latest_quarter = latest_key
            latest_label = f"{latest_year}" if period == "year" else f"Q{latest_quarter} '{str(latest_year)[-2:]}"

            waterfall = {
                "period": latest_label,
                "revenue": latest_income.get("revenue"),
                "cogs": latest_income.get("cogs"),
                "gross_profit": latest_income.get("gross_profit"),
                "selling_admin_expense": latest_income.get("selling_admin_expense"),
                "operating_profit": latest_income.get("operating_profit"),
                "other_income_expense": latest_income.get("other_income_expense"),
                "profit_before_tax": latest_income.get("profit_before_tax"),
                "tax": latest_income.get("tax"),
                "net_profit": latest_income.get("net_profit"),
            }

            position = {
                "period": latest_label,
                "current_assets": latest_balance.get("current_assets"),
                "non_current_assets": latest_balance.get("non_current_assets"),
                "current_liabilities": latest_balance.get("current_liabilities"),
                "non_current_liabilities": latest_balance.get("non_current_liabilities"),
                "total_assets": latest_balance.get("total_assets"),
                "total_liabilities": latest_balance.get("total_liabilities"),
            }

            return jsonify(
                {
                    "success": True,
                    "data": {
                        "series": series,
                        "waterfall": waterfall,
                        "position": position,
                    },
                }
            )
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/financial-dashboard error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
