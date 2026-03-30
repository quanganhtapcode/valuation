"""Corporate events route — proxies VCI IQ events API."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import requests as http_requests
from flask import Blueprint, jsonify, request, Response

from .deps import cache_func

logger = logging.getLogger(__name__)

_VCI_HEADERS = {
    'accept': 'application/json',
    'user-agent': (
        'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'
    ),
    'origin': 'https://trading.vietcap.com.vn',
    'referer': 'https://trading.vietcap.com.vn/',
    'x-requested-with': 'XMLHttpRequest',
}

_EVENTS_URL  = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/events'
_EXPORT_URL  = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/events/export-events'


def _today_yyyymmdd() -> str:
    return datetime.now(tz=timezone.utc).strftime('%Y%m%d')


def _fetch_events(date: str) -> list:
    """Fetch events for a single date from VCI. Returns list of event dicts."""
    try:
        r = http_requests.get(
            _EVENTS_URL,
            params={'fromDate': date, 'toDate': date, 'language': 1},
            headers=_VCI_HEADERS,
            timeout=10,
        )
        if r.status_code != 200:
            logger.warning('events: VCI returned %s', r.status_code)
            return []
        body = r.json()
        return body.get('data', {}).get('content', [])
    except Exception as exc:
        logger.error('events fetch error: %s', exc)
        return []


def register(market_bp: Blueprint) -> None:

    @market_bp.route('/events', methods=['GET'])
    def api_events():
        """Corporate events for a given date (YYYYMMDD). Cached 15 min."""
        date = request.args.get('date', _today_yyyymmdd())
        # Basic validation
        if len(date) != 8 or not date.isdigit():
            return jsonify({'error': 'invalid date, use YYYYMMDD'}), 400

        cache_key = f'market_events_{date}'
        try:
            data, _ = cache_func()(cache_key, 900, lambda: _fetch_events(date))
            return jsonify(data)
        except Exception as exc:
            logger.error('events route error: %s', exc)
            return jsonify([])

    @market_bp.route('/events/export', methods=['GET'])
    def api_events_export():
        """Stream xlsx export from VCI for a date range."""
        from_date = request.args.get('fromDate', _today_yyyymmdd())
        to_date   = request.args.get('toDate', from_date)

        if not (from_date.isdigit() and to_date.isdigit()):
            return jsonify({'error': 'invalid date'}), 400

        try:
            r = http_requests.get(
                _EXPORT_URL,
                params={'fromDate': from_date, 'toDate': to_date, 'language': 1},
                headers={**_VCI_HEADERS, 'accept': '*/*'},
                timeout=15,
                stream=True,
            )
            if r.status_code != 200:
                return jsonify({'error': 'export failed'}), 502

            filename = f'events_{from_date}_{to_date}.xlsx'
            return Response(
                r.iter_content(chunk_size=8192),
                status=200,
                headers={
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': f'attachment; filename="{filename}"',
                },
            )
        except Exception as exc:
            logger.error('events export error: %s', exc)
            return jsonify({'error': str(exc)}), 500
