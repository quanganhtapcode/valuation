"""Validate public valuation assumptions before reading databases or calculating."""
from __future__ import annotations

import math

MODEL_KEYS = ('fcfe', 'fcff', 'justified_pe', 'justified_pb', 'graham')


class ValuationInputError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def validate_valuation_request(data: object) -> dict:
    if not isinstance(data, dict):
        raise ValuationInputError('body', 'Expected a JSON object of valuation assumptions')
    bounds = {
        'currentPrice': (0, 1_000_000_000),
        'revenueGrowth': (-99, 100),
        'terminalGrowth': (0, 10),
        'requiredReturn': (0, 100),
        'wacc': (0, 100),
        'baseWacc': (0.01, 100),
        'baseGrowth': (-99, 100),
        'taxRate': (0, 100),
        'projectionYears': (1, 20),
    }
    result = data.copy()
    for field, (minimum, maximum) in bounds.items():
        value = data.get(field)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            raise ValuationInputError(field, f'{field} must be a finite number') from None
        if isinstance(value, bool) or not math.isfinite(number) or not minimum <= number <= maximum:
            raise ValuationInputError(field, f'{field} must be between {minimum} and {maximum}')
        if field == 'projectionYears' and not number.is_integer():
            raise ValuationInputError(field, 'projectionYears must be a whole number')
        result[field] = number
    if data.get('useCustomWeights'):
        weights = data.get('modelWeights')
        if not isinstance(weights, dict) or any(key not in MODEL_KEYS for key in weights):
            raise ValuationInputError('modelWeights', 'Expected weights for supported valuation models')
        normalized = {}
        for model in MODEL_KEYS:
            value = weights.get(model, 0)
            try:
                weight = float(value)
            except (TypeError, ValueError, OverflowError):
                raise ValuationInputError('modelWeights', 'Model weights must be numbers from 0 to 100') from None
            if isinstance(value, bool) or not math.isfinite(weight) or not 0 <= weight <= 100:
                raise ValuationInputError('modelWeights', 'Model weights must be numbers from 0 to 100')
            normalized[model] = weight
        result['modelWeights'] = normalized
    return result
