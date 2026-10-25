"""Regression checks for shared TTL cache capacity and expiration."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.cache_utils import TTLCache


class TTLCacheTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.cache = TTLCache(max_entries=200, version_file=Path(directory.name) / 'versions.json')

    def test_updating_a_full_cache_preserves_other_live_entries(self):
        for index in range(200):
            self.cache.set(str(index), index)

        self.cache.set('199', 'updated')

        self.assertEqual(self.cache.get('0'), 0)
        self.assertEqual(self.cache.get('199'), 'updated')
        self.assertEqual(self.cache.stats()['size'], 200)
        self.assertEqual(self.cache.stats()['evictions'], 0)

    def test_new_entry_evicts_oldest_only_when_capacity_is_reached(self):
        for index in range(201):
            self.cache.set(str(index), index)

        self.assertIsNone(self.cache.get('0'))
        self.assertEqual(self.cache.get('1'), 1)
        self.assertEqual(self.cache.get('200'), 200)
        self.assertEqual(self.cache.stats()['size'], 200)
        self.assertEqual(self.cache.stats()['evictions'], 1)

    def test_expired_entries_are_evicted_before_live_entries(self):
        with patch('backend.cache_utils.time.time', return_value=1000):
            self.cache.set('live', 'keep', ttl=300)
            self.cache.set('expired', 'remove', ttl=1)
            for index in range(198):
                self.cache.set(str(index), index, ttl=300)
        with patch('backend.cache_utils.time.time', return_value=1002):
            self.cache.set('new', 'fresh')
            self.assertEqual(self.cache.get('live'), 'keep')
            self.assertIsNone(self.cache.get('expired'))
            self.assertEqual(self.cache.stats()['size'], 200)
            self.assertEqual(self.cache.stats()['expired_removed'], 1)
