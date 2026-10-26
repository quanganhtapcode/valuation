"""Corporate events route — proxies VCI IQ events API."""
from __future__ import annotations

import logging
from datetime import datetime
from time import monotonic
from zoneinfo import ZoneInfo

import requests as http_requests
from flask import Blueprint, jsonify, request, Response

from .deps import cache_func

logger = logging.getLogger(__name__)

_VCI_HEADERS = {
    'accept': 'application/json',
    'user-agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'origin': 'https://trading.vietcap.com.vn',
    'referer': 'https://trading.vietcap.com.vn/',
}

_EVENTS_URL  = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/events'
_EXPORT_URL  = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/events/export-events'


def _today_yyyymmdd() -> str:
    return datetime.now(tz=ZoneInfo('Asia/Ho_Chi_Minh')).strftime('%Y%m%d')


def _valid_date(value: str) -> bool:
    if len(value) != 8 or not value.isascii() or not value.isdigit():
        return False
    try:
        datetime.strptime(value, '%Y%m%d')
        return True
    except ValueError:
        return False


def _fetch_events(date: str, to_date: str | None = None) -> list:
    """Fetch all pages for a date or date range from VCI."""
    events = []
    deadline = monotonic() + 10
    for page in range(100):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise http_requests.Timeout('Events pagination timed out')
        r = http_requests.get(
            _EVENTS_URL,
            params={'fromDate': date, 'toDate': to_date or date, 'language': 1,
                    'page': page, 'size': 1000},
            headers=_VCI_HEADERS,
            timeout=(min(3, remaining), remaining),
        )
        r.raise_for_status()
        body = r.json()
        if (not isinstance(body, dict) or body.get('successful') is False
                or body.get('status') not in (None, 200, '200')):
            raise ValueError('Unsuccessful Vietcap events response')
        data = body.get('data')
        items = data.get('content') if isinstance(data, dict) else None
        if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
            raise ValueError('Invalid Vietcap events response')
        events.extend(items)
        total_pages = data.get('totalPages')
        if (data.get('last') is True
                or isinstance(total_pages, int) and page + 1 >= total_pages
                or total_pages is None and data.get('last') is None and len(items) < 1000):
            return events
        if not items:
            raise ValueError('Incomplete Vietcap events pagination')
    raise ValueError('Too many Vietcap events pages')


def register(market_bp: Blueprint) -> None:

    @market_bp.route('/events', methods=['GET'])
    def api_events():
        """Corporate events for a given date (YYYYMMDD). Cached 15 min."""
        date = request.args.get('fromDate', request.args.get('date', _today_yyyymmdd()))
        to_date = request.args.get('toDate', date)
        if not _valid_date(date) or not _valid_date(to_date):
            return jsonify({'error': 'invalid date, use YYYYMMDD'}), 400
        days = (datetime.strptime(to_date, '%Y%m%d') - datetime.strptime(date, '%Y%m%d')).days
        if not 0 <= days <= 6:
            return jsonify({'error': 'date range must contain 1 to 7 days'}), 400

        # Version the key so empty results cached by the old error handler expire unused.
        cache_key = f'market_events_v2_{date}_{to_date}'
        try:
            data, _ = cache_func()(cache_key, 900, lambda: _fetch_events(date, to_date))
            return jsonify(data)
        except http_requests.Timeout as exc:
            logger.warning('events upstream timeout: %s', exc)
            return jsonify({'error': 'Vietcap events request timed out'}), 504
        except Exception as exc:
            logger.error('events route error: %s', exc)
            return jsonify({'error': 'Vietcap events are temporarily unavailable'}), 502

    @market_bp.route('/events/export', methods=['GET'])
    def api_events_export():
        """Stream xlsx export from VCI for a date range."""
        from_date = request.args.get('fromDate', _today_yyyymmdd())
        to_date   = request.args.get('toDate', from_date)

        if not (_valid_date(from_date) and _valid_date(to_date)) or from_date > to_date:
            return jsonify({'error': 'invalid date'}), 400

        try:
            r = http_requests.get(
                _EXPORT_URL,
                params={'fromDate': from_date, 'toDate': to_date, 'language': 1},
                headers={**_VCI_HEADERS, 'accept': '*/*'},
                timeout=(3, 10),
                stream=True,
            )
            content_type = r.headers.get('Content-Type', '').lower()
            if r.status_code != 200 or 'json' in content_type or 'text/' in content_type:
                r.close()
                return jsonify({'error': 'export failed'}), 502

            filename = f'events_{from_date}_{to_date}.xlsx'
            response = Response(
                r.iter_content(chunk_size=8192),
                status=200,
                headers={
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': f'attachment; filename="{filename}"',
                },
            )
            response.call_on_close(r.close)
            return response
        except http_requests.Timeout as exc:
            logger.warning('events export timeout: %s', exc)
            return jsonify({'error': 'Vietcap events export timed out'}), 504
        except Exception as exc:
            logger.error('events export error: %s', exc)
            return jsonify({'error': 'Vietcap events export is temporarily unavailable'}), 502
