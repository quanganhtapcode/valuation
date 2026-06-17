from __future__ import annotations

import statistics


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(float(v) for v in values)
    n = len(values)
    mid = n // 2
    if n % 2 == 1:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2.0


def _summarize(values: list[float], computed_median: float | None) -> dict:
    if not values:
        return {
            'count': 0,
            'min': None,
            'max': None,
            'median_computed': computed_median,
            'std_dev': None,
        }
    std = float(statistics.stdev(values)) if len(values) >= 2 else None
    return {
        'count': len(values),
        'min': float(min(values)),
        'max': float(max(values)),
        'median_computed': computed_median,
        'std_dev': std,
    }


def _dcf_per_share(
    base_cashflow_per_share: float,
    annual_growth: float,
    discount_rate: float,
    terminal_growth_rate: float,
    years: int,
) -> tuple[float, dict]:
    details = {
        'base_cashflow_per_share': float(base_cashflow_per_share),
        'annual_growth': float(annual_growth),
        'discount_rate': float(discount_rate),
        'terminal_growth': float(terminal_growth_rate),
        'years': int(years),
        'pv_sum': 0.0,
        'terminal_value': 0.0,
        'terminal_value_discounted': 0.0,
        'result': 0.0,
        'notes': [],
    }

    if base_cashflow_per_share == 0:
        details['notes'].append('base_cashflow_per_share==0 (cannot run DCF)')
        return 0.0, details
    if discount_rate <= 0:
        details['notes'].append('discount_rate<=0 (invalid)')
        return 0.0, details

    tg = terminal_growth_rate
    if tg >= discount_rate:
        tg = max(0.0, discount_rate - 0.01)
        details['notes'].append('terminal_growth adjusted to keep (r > g)')
    if tg < 0:
        tg = 0.0
        details['notes'].append('terminal_growth clamped to 0')

    pv_sum = 0.0
    cashflows = []
    for t in range(1, years + 1):
        cf_t = float(base_cashflow_per_share * ((1.0 + annual_growth) ** t))
        pv_t = float(cf_t / ((1.0 + discount_rate) ** t))
        pv_sum += pv_t
        cashflows.append({'t': t, 'cashflow': cf_t, 'pv': pv_t})

    cf_n = float(base_cashflow_per_share * ((1.0 + annual_growth) ** years))
    tv = float((cf_n * (1.0 + tg)) / (discount_rate - tg))
    tv_disc = float(tv / ((1.0 + discount_rate) ** years))
    result = float(pv_sum + tv_disc)

    details['pv_sum'] = float(pv_sum)
    details['terminal_value'] = float(tv)
    details['terminal_value_discounted'] = float(tv_disc)
    details['cashflows'] = cashflows
    details['terminal_growth_used'] = float(tg)
    details['result'] = float(result)
    return result, details


def _compute_weighted_average(valuations: dict, weights: dict) -> float:
    total_val = 0.0
    total_weight = 0.0
    for key, weight in (weights or {}).items():
        val = _to_float(valuations.get(key))
        w = _to_float(weight)
        if val > 0 and w > 0:
            total_val += val * w
            total_weight += w
    return (total_val / total_weight) if total_weight > 0 else 0.0


def _quality_grade(score: float) -> str:
    s = _to_float(score)
    if s >= 85:
        return 'A'
    if s >= 70:
        return 'B'
    if s >= 55:
        return 'C'
    if s >= 40:
        return 'D'
    return 'F'


def _build_quality_score(inputs: dict, pe_count: int, pb_count: int, ps_count: int) -> dict:
    checks: list[dict] = []

    def add_check(name: str, passed: bool, points: int, detail: str = ''):
        checks.append(
            {
                'name': name,
                'passed': bool(passed),
                'points': int(points if passed else 0),
                'max_points': int(points),
                'detail': detail,
            }
        )

    eps_ok = _to_float(inputs.get('eps_ttm')) > 0
    bvps_ok = _to_float(inputs.get('bvps')) > 0
    shares_ok = _to_float(inputs.get('shares_outstanding')) > 0
    screening_group_ok = bool(inputs.get('industry_screening_key'))

    add_check('eps_ttm_available', eps_ok, 20, inputs.get('eps_source', 'missing'))
    add_check('bvps_available', bvps_ok, 15, inputs.get('bvps_source', 'missing'))
    add_check('shares_outstanding_available', shares_ok, 10, 'sqlite.ratio_wide.outstanding_share')
    add_check('pe_peer_sample_ge_10', int(pe_count) >= 10, 15, f'count={int(pe_count)}')
    add_check('pb_peer_sample_ge_10', int(pb_count) >= 10, 15, f'count={int(pb_count)}')
    add_check('ps_peer_sample_ge_10', int(ps_count) >= 10, 15, f'count={int(ps_count)}')
    add_check('screening_industry_group_available', screening_group_ok, 10, str(inputs.get('industry_screening_key') or ''))

    total_points = int(sum(int(c.get('points', 0)) for c in checks))
    max_points = int(sum(int(c.get('max_points', 0)) for c in checks))
    pct = (100.0 * total_points / max_points) if max_points > 0 else 0.0

    return {
        'score': float(round(pct, 2)),
        'grade': _quality_grade(pct),
        'raw_points': total_points,
        'max_points': max_points,
        'checks': checks,
    }


def _calc_scenario(
    name: str,
    fcfe_base_per_share: float,
    fcff_base_per_share: float,
    eps: float,
    bvps: float,
    pe_used: float,
    pb_used: float,
    graham: float,
    weights: dict,
    projection_years: int,
    growth: float,
    terminal_growth: float,
    required_return: float,
    wacc: float,
    multiple_factor: float,
    current_price: float,
) -> dict:
    fcfe_value, _ = _dcf_per_share(
        base_cashflow_per_share=float(fcfe_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(required_return),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )
    fcff_value, _ = _dcf_per_share(
        base_cashflow_per_share=float(fcff_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(wacc),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )

    vals = {
        'fcfe': float(fcfe_value),
        'fcff': float(fcff_value),
        'justified_pe': float(eps * pe_used * multiple_factor) if eps > 0 else 0.0,
        'justified_pb': float(bvps * pb_used * multiple_factor) if bvps > 0 else 0.0,
        'graham': float(graham),
    }
    weighted = _compute_weighted_average(vals, weights)
    vals['weighted_average'] = float(weighted)

    upside = 0.0
    if _to_float(current_price) > 0 and weighted > 0:
        upside = ((weighted - current_price) / current_price) * 100.0

    return {
        'name': name,
        'assumptions': {
            'growth': float(growth),
            'terminal_growth': float(terminal_growth),
            'required_return': float(required_return),
            'wacc': float(wacc),
            'multiple_factor': float(multiple_factor),
        },
        'valuations': vals,
        'upside_pct': float(upside),
    }


def _build_default_scenarios(
    fcfe_base_per_share: float,
    fcff_base_per_share: float,
    eps: float,
    bvps: float,
    pe_used: float,
    pb_used: float,
    graham: float,
    weights: dict,
    projection_years: int,
    growth: float,
    terminal_growth: float,
    required_return: float,
    wacc: float,
    current_price: float,
) -> dict:
    base = _calc_scenario(
        name='base',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        pe_used=pe_used,
        pb_used=pb_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=growth,
        terminal_growth=terminal_growth,
        required_return=required_return,
        wacc=wacc,
        multiple_factor=1.0,
        current_price=current_price,
    )

    bull = _calc_scenario(
        name='bull',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        pe_used=pe_used,
        pb_used=pb_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=min(0.30, growth + 0.02),
        terminal_growth=min(0.08, terminal_growth + 0.005),
        required_return=max(0.05, required_return - 0.01),
        wacc=max(0.05, wacc - 0.01),
        multiple_factor=1.1,
        current_price=current_price,
    )

    bear = _calc_scenario(
        name='bear',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        pe_used=pe_used,
        pb_used=pb_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=max(-0.10, growth - 0.02),
        terminal_growth=max(0.0, terminal_growth - 0.005),
        required_return=min(0.35, required_return + 0.01),
        wacc=min(0.35, wacc + 0.01),
        multiple_factor=0.9,
        current_price=current_price,
    )

    return {'bear': bear, 'base': base, 'bull': bull}
