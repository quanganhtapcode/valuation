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
    from .details import register as register_details
    from .overview import register as register_overview
    from .charts import register as register_charts
    from .profile import register as register_profile
    from .history import register as register_history
    from .news_events import register as register_news_events
    from .revenue_profit import register as register_revenue_profit
    from .financial_dashboard import register as register_financial_dashboard
    from .valuation import register as register_valuation
    from .companies import register as register_companies
    from .financials import register as register_financials
    from .peers import register as register_peers
    from .metrics import register as register_metrics
    from .freshness import register as register_freshness
    from .holders import register as register_holders
    from .loan_breakdown import register as register_loan_breakdown
    from .ai_analysis import register as register_ai_analysis
    from .technical import register as register_technical

    register_prices(target)
    register_details(target)
    register_overview(target)
    register_charts(target)
    register_profile(target)
    register_history(target)
    register_news_events(target)
    register_revenue_profit(target)
    register_financial_dashboard(target)
    register_valuation(target)
    register_companies(target)
    register_financials(target)
    register_peers(target)
    register_metrics(target)
    register_freshness(target)
    register_holders(target)
    register_loan_breakdown(target)
    register_ai_analysis(target)
    register_technical(target)


# Auto-register when module is imported (for server.py that just does `from .stock import stock_bp`)
register_stock_routes()
