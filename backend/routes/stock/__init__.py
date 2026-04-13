from __future__ import annotations

from flask import Blueprint


def register_stock_routes(bp: Blueprint) -> None:
    """Register all /api/* stock routes onto the provided blueprint."""

    # Local imports keep startup fast and avoid circular dependencies.
    from .prices import register as register_prices
    from .stock_data import register as register_stock_data
    from .stock_overview import register as register_stock_overview
    from .charts import register as register_charts
    from .profile import register as register_profile
    from .history import register as register_history
    from .misc import register as register_misc
    from .news_events import register as register_news_events
    from .revenue_profit import register as register_revenue_profit
    from .financial_dashboard import register as register_financial_dashboard
    from .valuation import register as register_valuation
    from .missing_routes import register as register_missing_routes

    register_prices(bp)
    register_stock_data(bp)
    register_stock_overview(bp)
    register_charts(bp)
    register_profile(bp)
    register_history(bp)
    register_misc(bp)
    register_news_events(bp)
    register_revenue_profit(bp)
    register_financial_dashboard(bp)
    register_valuation(bp)
    register_missing_routes(bp)
