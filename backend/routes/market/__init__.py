"""Market routes blueprint (modular).

Public contract (must remain stable):
- Exports `market_bp`
- Exports `init_market_routes(get_cached_func, cache_ttl, gold_service)`
"""

from __future__ import annotations

import logging

from flask import Blueprint

from .deps import set_deps


logger = logging.getLogger(__name__)


market_bp = Blueprint("market", __name__, url_prefix="/api/market")


def init_market_routes(get_cached_func, cache_ttl, gold_service) -> None:
    """Initialize market routes with dependencies (cache wrapper + TTLs + gold service)."""
    set_deps(get_cached_func=get_cached_func, cache_ttl=cache_ttl, gold_service=gold_service)


def register_market_routes(bp: Blueprint) -> None:
    from .gold import register as register_gold
    from .prices import register as register_prices
    from .valuation_chart import register as register_cafef
    from .foreign import register as register_foreign
    from .news import register as register_news
    from .movers import register as register_movers
    from .vci_indices import register as register_vci_indices
    from .index_history import register as register_index_history
    from .lottery import register as register_lottery
    from .world_indices import register as register_world_indices
    from .heatmap import register as register_heatmap
    from .overview_refresh import register as register_overview_refresh

    register_gold(bp)
    register_prices(bp)
    register_cafef(bp)
    register_foreign(bp)
    register_news(bp)
    register_movers(bp)
    register_vci_indices(bp)
    register_index_history(bp)
    register_lottery(bp)
    register_world_indices(bp)
    register_heatmap(bp)
    register_overview_refresh(bp)


# Register routes at import time (deps are set later by init_market_routes).
register_market_routes(market_bp)
