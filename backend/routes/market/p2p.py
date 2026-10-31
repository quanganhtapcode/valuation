"""Live P2P snapshot using the same sources and filters as history collection."""
from __future__ import annotations

import json
import logging
from pathlib import Path
import subprocess
import threading
import time

from flask import Blueprint, jsonify

from .p2p_cash import read_cash_usd

ROOT = Path(__file__).resolve().parents[3]
LOGGER = logging.getLogger(__name__)
_lock = threading.Lock()
_cached: dict | None = None
_cached_at = 0.0


def get_snapshot() -> dict:
    global _cached, _cached_at
    with _lock:
        if _cached is not None and time.monotonic() - _cached_at < 60:
            return _cached
        result = subprocess.run(
            ['node', str(ROOT / 'automation' / 'p2p_snapshot.mjs')],
            cwd=ROOT, capture_output=True, text=True, timeout=45, check=True,
        )
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or not all(key in data for key in ('okx', 'binance', 'fetchedAt')):
            raise ValueError('Invalid P2P snapshot')
        if not data.get('cashUsd'):
            cash = read_cash_usd()
            if cash:
                data['cashUsd'] = {'buy': cash['buy'], 'sell': cash['sell']}
        _cached = data
        _cached_at = time.monotonic()
        return data


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/p2p', methods=['GET'])
    def get_p2p():
        try:
            response = jsonify(get_snapshot())
            response.headers['Cache-Control'] = 'no-store'
            return response
        except (OSError, subprocess.SubprocessError, ValueError, TypeError):
            LOGGER.exception('Unable to collect P2P snapshot')
            return jsonify({'error': 'P2P rates unavailable'}), 503, {'Cache-Control': 'no-store'}
