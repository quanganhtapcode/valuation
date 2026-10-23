import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from threading import Event
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('direct_gold', ROOT / 'backend/services/gold.py')
gold = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gold)
from backend.fund_snapshot import publish_snapshot, read_snapshot

HTML = '''<p>Giá vàng cập nhật lần cuối lúc 18:27 12/10/2026</p><table><th>(VNĐ/Chỉ)</th>
<tr><td>Vàng miếng SJC</td><td>14,080,000</td><td>14,430,000</td></tr>
<tr><td>Nhẫn tròn Phú Quý 999.9</td><td>14,080,000</td><td>14,380,000</td></tr>
<tr><td>Ph&#250; Qu&#253; 1 Lượng 999.9</td><td>14,080,000</td><td>14,380,000</td></tr>
<tr><td>Phú quý 1 lượng 99.9</td><td>14,070,000</td><td>14,370,000</td></tr>
<tr><td>Bạc thỏi Phú Quý 999 (1Kilo, 10 lượng, 5 lượng, 1 lượng)</td><td>210,500</td><td>217,000</td></tr></table>'''


class MarketSnapshots(unittest.TestCase):
    def test_exact_purity_units_timestamp(self):
        rows = gold.parse_gold(HTML)
        self.assertEqual([r['Id'] for r in rows], [1, 2, 3, 4])
        self.assertEqual(rows[2]['buy_price'], 14080000)
        self.assertEqual(rows[3]['buy_price'], 210500)
        self.assertTrue(all(r['Unit'] == 'VNĐ/chỉ' for r in rows))
        self.assertEqual(gold.issuer_timestamp(HTML), '2026-10-12T18:27:00+07:00')

    def test_reject_structure_or_unit_change(self):
        for html in [HTML.replace('VNĐ/Chỉ', 'VNĐ/Lượng'), HTML.replace('1 Lượng 999.9', '1 Lượng 99.9')]:
            with self.assertRaises(ValueError):
                gold.parse_gold(html)

    def test_cached_single_request_and_failure_retains_quotes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(gold, 'CACHE_PATH', Path(directory) / 'gold.json'):
            response = Mock(text=HTML)
            with patch.object(gold.requests, 'get', return_value=response) as get:
                first = gold.GoldService.fetch_once()
                self.assertEqual(len(first['data']), 4)
                self.assertEqual(get.call_args.args[0], 'https://phuquygroup.vn/giavang')
                gold.GoldService.fetch_once()
                self.assertEqual(get.call_count, 1)
            first['fetched_at'] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            gold.CACHE_PATH.write_text(json.dumps(first), encoding='utf8')
            with patch.object(gold.requests, 'get', side_effect=gold.requests.Timeout()):
                stale = gold.GoldService.fetch_once()
            self.assertTrue(stale['stale'])
            self.assertEqual(stale['data'], first['data'])
            self.assertEqual(stale['fetched_at'], first['fetched_at'])

    def test_stale_gold_returns_while_single_refresh_is_blocked(self):
        started, release, finished = Event(), Event(), Event()
        cached = {"success": True, "data": [{"Id": 1}, {"Id": 2}],
                  "fetched_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()}

        def slow_fetch():
            started.set()
            release.wait(2)
            finished.set()

        with patch.object(gold, 'read_cache', return_value=cached), \
             patch.object(gold.GoldService, '_retry_after', 0), \
             patch.object(gold.GoldService, 'fetch_once', side_effect=slow_fetch) as fetch:
            try:
                first = gold.GoldService.snapshot()
                self.assertTrue(started.wait(1))
                second = gold.GoldService.snapshot()
                self.assertTrue(first['stale'])
                self.assertEqual(first['data'], cached['data'])
                self.assertEqual(second, first)
                self.assertEqual(fetch.call_count, 1)
            finally:
                release.set()
                self.assertTrue(finished.wait(1))

    def test_funds_atomic_validation_and_stale(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'funds.json'
            with patch.dict(os.environ, {'FUNDS_DB_PATH': str(Path(directory) / 'funds.sqlite')}):
                good = publish_snapshot([{'short_name': 'TEST', 'fund_id_fmarket': 1, 'nav_update_at': '2026-10-12', 'nav': '12345.67', 'nav_change_1m': 'NaN'}], path)
            self.assertEqual(good['data'][0]['nav'], 12345.67)
            self.assertIsNone(good['data'][0]['nav_change_1m'])
            for records in [[], [{'short_name': 'TEST', 'nav': 'NaN'}]]:
                with self.assertRaises(ValueError):
                    publish_snapshot(records, path)
                self.assertEqual(json.loads(path.read_text()), good)
            good['fetched_at'] = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
            path.write_text(json.dumps(good))
            with patch.dict(os.environ, {'FUNDS_SNAPSHOT_PATH': str(path)}):
                self.assertTrue(read_snapshot()['stale'])


if __name__ == '__main__':
    unittest.main()
