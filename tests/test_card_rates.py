from datetime import date
import unittest
from unittest.mock import Mock, patch

from backend.services import card_rates


class CardRatesTest(unittest.TestCase):
    def test_selects_recent_visa_usd_to_vnd_only(self):
        content = '''date,to_curr,provider,rate,markup
2026-11-04,VND,VISA,25800,0
2026-11-05,VND,MASTERCARD,26000,0
2026-11-06,VND,VISA,26000,0
2026-11-05,VND,VISA,nan,0
2026-11-03,VND,VISA,25700,0
2026-11-05,EUR,VISA,0.9,0
'''
        self.assertEqual(card_rates.parse_visa_rate(content, date(2026, 11, 5)),
                         {'rate': 25800.0, 'date': '2026-11-04', 'source': 'ForexRadar', 'feePercent': 0})
        self.assertIsNone(card_rates.parse_visa_rate(content, date(2026, 11, 10)))

    def test_source_failure_does_not_break_other_rates(self):
        card_rates._next_refresh = 0
        card_rates._cached = None
        card_rates._mastercard_next_refresh = 0
        card_rates._mastercard_cached = None
        with patch.object(card_rates.requests, 'get', side_effect=card_rates.requests.Timeout('timeout')), \
                patch.object(card_rates.LOGGER, 'warning', Mock()):
            self.assertEqual(card_rates.get_card_rates(), {'visa': None, 'mastercard': None})

    def test_mastercard_uses_returned_date_and_no_cookie(self):
        card_rates._mastercard_next_refresh = 0
        response = Mock()
        response.json.return_value = {'data': {'conversionRate': '25710', 'fxDate': '2026-11-04',
                                               'transCurr': 'USD', 'crdhldBillCurr': 'VND'}}
        with patch.object(card_rates.requests, 'get', return_value=response) as request:
            result = card_rates.get_mastercard_rate(date(2026, 11, 5))
        self.assertEqual(result['rate'], 25710)
        self.assertEqual(result['date'], '2026-11-04')
        self.assertEqual(request.call_args.kwargs['params']['bank_fee'], '0')
        self.assertNotIn('Cookie', request.call_args.kwargs['headers'])

    def test_mastercard_rejects_stale_data(self):
        card_rates._mastercard_next_refresh = 0
        response = Mock()
        response.json.return_value = {'data': {'conversionRate': '25710', 'fxDate': '2026-03-01',
                                               'transCurr': 'USD', 'crdhldBillCurr': 'VND'}}
        with patch.object(card_rates.requests, 'get', return_value=response), \
                patch.object(card_rates.LOGGER, 'warning', Mock()):
            self.assertIsNone(card_rates.get_mastercard_rate(date(2026, 11, 5)))


if __name__ == '__main__':
    unittest.main()
