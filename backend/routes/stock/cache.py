"""Bounded response cache shared by stock and company routes."""

import time as _time
from threading import RLock

_cache: dict = {}

_CACHE_TTL = 600  # 10 min

_CACHE_MAX_ENTRIES = 300

_CACHE_LOCK = RLock()

def _cache_get(key):
    with _CACHE_LOCK:
        entry = _cache.get(key)
        if entry is not None:
            if (_time.monotonic() - entry[0]) < _CACHE_TTL:
                return entry[1]
            _cache.pop(key, None)
    return None

def _cache_set(key, data):
    now = _time.monotonic()
    with _CACHE_LOCK:
        _cache.pop(key, None)
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            for expired in [k for k, (stamp, _) in _cache.items() if now - stamp >= _CACHE_TTL]:
                _cache.pop(expired, None)
        while len(_cache) >= _CACHE_MAX_ENTRIES:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (now, data)
