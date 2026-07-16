"""Sector and size-aware valuation policy for Vietnamese equities.

The policy deliberately separates *how a company is valued* from calculation
code. ICB is the primary classifier; market-cap tier and the company's rank in
the ICB cohort refine peer selection and model weights. This avoids applying a
single, opaque five-model blend to every listed company.
"""
from __future__ import annotations

from typing import Iterable


MODEL_WEIGHTS: dict[str, dict[str, int]] = {
    # DCF and forward earnings are generally more informative for asset-light,
    # high-ROE technology businesses; P/B and Graham are not decision models.
    "technology": {"fcfe": 15, "fcff": 40, "justified_pe": 45, "justified_pb": 0, "graham": 0},
    "bank": {"fcfe": 0, "fcff": 0, "justified_pe": 30, "justified_pb": 70, "graham": 0},
    "securities": {"fcfe": 15, "fcff": 0, "justified_pe": 30, "justified_pb": 55, "graham": 0},
    "real_estate": {"fcfe": 15, "fcff": 20, "justified_pe": 15, "justified_pb": 50, "graham": 0},
    "utility": {"fcfe": 25, "fcff": 50, "justified_pe": 25, "justified_pb": 0, "graham": 0},
    "cyclical": {"fcfe": 20, "fcff": 35, "justified_pe": 30, "justified_pb": 15, "graham": 0},
    "general": {"fcfe": 25, "fcff": 35, "justified_pe": 30, "justified_pb": 10, "graham": 0},
}

GROWTH_POLICY: dict[str, tuple[float, float, float]] = {
    # (fallback, floor, ceiling). These are guardrails around observed EPS
    # growth, not target-price assumptions.
    "technology": (0.10, 0.03, 0.25),
    "bank": (0.08, 0.03, 0.15),
    "securities": (0.08, 0.02, 0.18),
    "real_estate": (0.08, 0.02, 0.18),
    "utility": (0.05, 0.02, 0.10),
    "cyclical": (0.05, 0.00, 0.10),
    "general": (0.08, 0.02, 0.15),
}


def market_cap_tier(market_cap_vnd: float) -> str:
    """Return a Vietnam-market market-cap tier (VND, not millions)."""
    if market_cap_vnd >= 100_000_000_000_000:
        return "mega"  # >= VND100tn
    if market_cap_vnd >= 30_000_000_000_000:
        return "large"  # >= VND30tn
    if market_cap_vnd >= 5_000_000_000_000:
        return "mid"  # >= VND5tn
    return "small"


def sector_archetype(*labels: object, is_bank: bool = False) -> str:
    if is_bank:
        return "bank"
    text = " ".join(str(label or "").lower() for label in labels)
    if any(x in text for x in ("ngân hàng", "bank")):
        return "bank"
    if any(x in text for x in ("chứng khoán", "securities", "financial services")):
        return "securities"
    if any(x in text for x in ("bất động sản", "real estate", "property")):
        return "real_estate"
    if any(x in text for x in ("công nghệ", "technology", "software", "thiết bị và phần cứng")):
        return "technology"
    if any(x in text for x in ("điện", "nước", "gas", "utility", "utilities")):
        return "utility"
    if any(x in text for x in ("thép", "steel", "khai khoáng", "mining", "hóa chất", "chemicals", "vận tải", "transport")):
        return "cyclical"
    return "general"


def suggest_growth(archetype: str, cagr_3y: float | None, cagr_5y: float | None, terminal_growth: float) -> dict:
    """Return a transparent, guarded growth suggestion from EPS history.

    Recent three-year growth gets more weight than the five-year series. The
    guardrails prevent a one-off cycle peak/trough from becoming a perpetual
    five-year DCF forecast.
    """
    fallback, floor, ceiling = GROWTH_POLICY.get(archetype, GROWTH_POLICY["general"])
    values = [x for x in (cagr_3y, cagr_5y) if x is not None]
    if cagr_3y is not None and cagr_5y is not None:
        raw = 0.70 * float(cagr_3y) + 0.30 * float(cagr_5y)
        source = "70% EPS CAGR 3Y + 30% EPS CAGR 5Y"
    elif values:
        raw = float(values[0])
        source = "available EPS CAGR"
    else:
        raw = fallback
        source = "sector fallback"
    used = min(ceiling, max(max(floor, terminal_growth), raw))
    return {"raw": float(raw), "used": float(used), "source": source, "floor": floor, "ceiling": ceiling}


def _rank_in_cohort(market_cap: float, cohort_market_caps: Iterable[float]) -> tuple[int | None, int, float | None]:
    caps = sorted((float(x) for x in cohort_market_caps if float(x) > 0), reverse=True)
    if not caps or market_cap <= 0:
        return None, len(caps), None
    rank = 1 + sum(1 for cap in caps if cap > market_cap)
    percentile = 1.0 - ((rank - 1) / max(1, len(caps) - 1))
    return rank, len(caps), percentile


def icb_size_bucket(percentile: float | None, cohort_count: int) -> str:
    """Relative size bucket inside an ICB cohort, not the whole market."""
    if percentile is None or cohort_count < 4:
        return "insufficient_icb_sample"
    if percentile >= 0.75:
        return "icb_leader_quartile"
    if percentile >= 0.50:
        return "icb_upper_middle"
    if percentile >= 0.25:
        return "icb_lower_middle"
    return "icb_smaller_companies"


def build_valuation_policy(
    *,
    industry: str,
    screening_industry_name: str | None,
    market_cap: float,
    cohort_market_caps: Iterable[float],
    is_bank: bool,
) -> dict:
    archetype = sector_archetype(industry, screening_industry_name, is_bank=is_bank)
    tier = market_cap_tier(market_cap)
    rank, cohort_count, percentile = _rank_in_cohort(market_cap, cohort_market_caps)
    is_leader = bool(percentile is not None and percentile >= 0.75 and cohort_count >= 4)

    return {
        "version": "icb-size-v1",
        "archetype": archetype,
        "market_cap": float(market_cap),
        "market_cap_tier": tier,
        "icb_size_bucket": icb_size_bucket(percentile, cohort_count),
        "icb_rank": rank,
        "icb_cohort_count": cohort_count,
        "icb_market_cap_percentile": round(float(percentile), 4) if percentile is not None else None,
        "is_icb_leader": is_leader,
        "model_weights": MODEL_WEIGHTS[archetype].copy(),
        "peer_selection": {
            "primary": "same ICB level-2 cohort",
            "refinement": "prefer peers within 0.33x–3.0x market cap; widen to 0.10x–10.0x, then full ICB cohort only when necessary",
            "leader_treatment": "select quality-adjusted peer percentile; never apply an automatic VN30 premium",
        },
        "required_models": {
            "technology": ["segment/SOTP or forward P/E", "FCFF DCF"],
            "bank": ["justified P/B / excess-return", "forward P/E"],
            "securities": ["justified P/B / ROE", "FCFE"],
            "real_estate": ["RNAV / SOTP", "recurring-income DCF"],
            "utility": ["FCFF DCF", "dividend model"],
            "cyclical": ["mid-cycle earnings", "normalized EV/EBITDA"],
            "general": ["FCFF DCF", "forward P/E"],
        }[archetype],
    }
