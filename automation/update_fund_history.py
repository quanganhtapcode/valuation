"""Backfill once, then refresh overlapping recent NAV each day."""
from __future__ import annotations

import argparse
import fcntl
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from backend.fund_snapshot import read_snapshot
from backend.fund_store import connect, save_history, save_listing

logger = logging.getLogger('fund_history')
URL = 'https://api.fmarket.vn/res/product/get-nav-history'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    with open('/var/tmp/valuation-fund-history.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            logger.info('Another collector is already running')
            return
        snapshot = read_snapshot()
        if not snapshot.get('success'):
            raise RuntimeError('No valid listing snapshot')
        save_listing(snapshot['data'])
        db = connect()
        try:
            funds = db.execute('''SELECT f.*,MAX(n.date) AS last_date FROM funds f
                LEFT JOIN fund_nav n USING(symbol) GROUP BY f.symbol ORDER BY f.symbol''').fetchall()
        finally:
            db.close()
        session = requests.Session()
        session.headers.update({'Origin': 'https://fmarket.vn', 'Referer': 'https://fmarket.vn/', 'User-Agent': 'Mozilla/5.0'})
        session.mount('https://', HTTPAdapter(max_retries=Retry(total=2, backoff_factor=1, allowed_methods={'POST'}, status_forcelist=[429, 500, 502, 503, 504])))
        failures = 0
        today = datetime.now(ZoneInfo('Asia/Ho_Chi_Minh'))
        for fund in funds:
            full = args.full or not fund['history_updated_at'] or today.day == 1
            # Re-read seven days to incorporate corrections, even if the listing
            # has already recorded a newer NAV than the previous collection.
            start = (datetime.fromisoformat(fund['last_date']) - timedelta(days=7)).strftime('%Y%m%d') if fund['last_date'] else None
            try:
                response = session.post(URL, json={'isAllData': 1 if full else 0, 'productId': fund['product_id'], 'fromDate': None if full else start, 'toDate': today.strftime('%Y%m%d')}, timeout=(5, 25))
                response.raise_for_status()
                rows = response.json().get('data')
                if not isinstance(rows, list):
                    raise ValueError('Unexpected NAV response')
                if not rows and not full:
                    db = connect()
                    try:
                        with db:
                            db.execute('UPDATE funds SET history_updated_at=?,history_error=NULL WHERE symbol=?', (today.isoformat(), fund['symbol']))
                    finally:
                        db.close()
                    logger.info('%s: no new published NAV', fund['symbol'])
                    continue
                save_history(fund['symbol'], rows)
                logger.info('%s: %s NAV rows (%s)', fund['symbol'], len(rows), 'full' if full else 'incremental')
            except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
                failures += 1
                db = connect()
                try:
                    with db:
                        db.execute('UPDATE funds SET history_error=? WHERE symbol=?', (type(exc).__name__, fund['symbol']))
                finally:
                    db.close()
                logger.error('%s: %s; existing history retained', fund['symbol'], type(exc).__name__)
        session.close()
        logger.info('Completed %s funds; %s failed', len(funds), failures)
        if failures:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
