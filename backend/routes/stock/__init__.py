from __future__ import annotations

from flask import Blueprint

# Create the shared blueprint
stock_bp = Blueprint('stock', __name__)


def register_stock_routes(bp: Blueprint | None = None) -> None:
    """Register all /api/* stock routes onto the provided blueprint.
    If no blueprint is passed, uses the module-level stock_bp.
    """
    target = bp or stock_bp

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
    from .holders import register as register_holders

    register_prices(target)
    register_stock_data(target)
    register_stock_overview(target)
    register_charts(target)
    register_profile(target)
    register_history(target)
    register_misc(target)
    register_news_events(target)
    register_revenue_profit(target)
    register_financial_dashboard(target)
    register_valuation(target)
    register_missing_routes(target)
    register_holders(target)


# Auto-register when module is imported (for server.py that just does `from .stock import stock_bp`)
register_stock_routes()
