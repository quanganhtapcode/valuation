"""
Simple TTL Cache Implementation
Fast in-memory caching without external dependencies
"""
import json
import os
import time
import threading
from functools import wraps
from pathlib import Path
from typing import Any, Optional, Callable
import logging

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_NAMESPACE_VERSION_FILE = Path(
    os.getenv("CACHE_NAMESPACE_VERSION_FILE", str(_PROJECT_ROOT / "logs" / "cache_namespace_versions.json"))
)
_VERSION_SYNC_INTERVAL_SECONDS = max(1.0, float(os.getenv("CACHE_VERSION_SYNC_INTERVAL_SECONDS", "5")))


class TTLCache:
    """Thread-safe TTL cache with automatic expiration"""
    
    def __init__(self, max_entries: int = 2000, version_file: Path | None = None):
        self._cache = {}
        self._lock = threading.RLock()
        self._max_entries = max(200, int(max_entries or 2000))
        self._key_versions = {}
        self._version_file = Path(version_file or _DEFAULT_NAMESPACE_VERSION_FILE)
        self._version_file.parent.mkdir(parents=True, exist_ok=True)
        self._last_versions_sync_at = 0.0
        self._version_sync_interval = _VERSION_SYNC_INTERVAL_SECONDS
        self._version_sync_errors = 0
        self._hits = 0
        self._misses = 0
        self._sets = 0
        self._deletes = 0
        self._evictions = 0
        self._expired_removals = 0
        self._sync_versions_if_needed(force=True)

    def _safe_namespace(self, namespace: str) -> str:
        ns = (namespace or 'global').strip().lower()
        if not ns:
            return 'global'
        return ns.replace(' ', '_')

    def _versioned_key(self, namespace: str, key: str) -> str:
        self._sync_versions_if_needed()
        ns = self._safe_namespace(namespace)
        ver = self._key_versions.get(ns, 1)
        return f"{ns}:v{ver}:{key}"

    def _read_versions_file(self) -> dict[str, int]:
        try:
            if not self._version_file.exists():
                return {}

            raw = self._version_file.read_text(encoding='utf-8').strip()
            if not raw:
                return {}

            data = json.loads(raw)
            source = data.get('versions') if isinstance(data, dict) else data
            if not isinstance(source, dict):
                return {}

            out: dict[str, int] = {}
            for k, v in source.items():
                ns = self._safe_namespace(str(k))
                try:
                    out[ns] = max(1, int(v))
                except Exception:
                    continue
            return out
        except Exception as exc:
            self._version_sync_errors += 1
            logger.debug(f"Cache version file read failed: {exc}")
            return {}

    def _write_versions_file(self, versions: dict[str, int]) -> None:
        payload = {
            'updated_at': int(time.time()),
            'versions': versions,
        }
        tmp_file = self._version_file.with_suffix(f"{self._version_file.suffix}.tmp")
        tmp_file.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding='utf-8')
        tmp_file.replace(self._version_file)

    def _sync_versions_if_needed(self, force: bool = False) -> None:
        now = time.time()
        if not force and (now - self._last_versions_sync_at) < self._version_sync_interval:
            return

        with self._lock:
            now = time.time()
            if not force and (now - self._last_versions_sync_at) < self._version_sync_interval:
                return

            external = self._read_versions_file()
            self._last_versions_sync_at = now
            if not external:
                return

            changed_namespaces: list[str] = []
            for ns, ext_ver in external.items():
                cur_ver = self._key_versions.get(ns, 1)
                if ext_ver > cur_ver:
                    self._key_versions[ns] = ext_ver
                    changed_namespaces.append(ns)

            if changed_namespaces:
                removed = 0
                for ns in changed_namespaces:
                    prefix = f"{ns}:v"
                    stale_keys = [k for k in self._cache.keys() if k.startswith(prefix)]
                    for k in stale_keys:
                        del self._cache[k]
                    removed += len(stale_keys)

                self._deletes += removed
                logger.info(
                    "Cache namespace version sync: %s (removed=%s)",
                    ",".join(f"{ns}->v{self._key_versions.get(ns, 1)}" for ns in changed_namespaces),
                    removed,
                )

    def _evict_one(self) -> None:
        # Remove one expired entry first, otherwise evict oldest inserted entry.
        now = time.time()
        for existing_key, (_, expires_at) in list(self._cache.items()):
            if now >= expires_at:
                del self._cache[existing_key]
                self._expired_removals += 1
                self._evictions += 1
                return
        if self._cache:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]
            self._evictions += 1

    def make_key(self, namespace: str, key: str) -> str:
        """Build a versioned namespaced cache key."""
        return self._versioned_key(namespace, key)

    def invalidate_namespace(self, namespace: str) -> int:
        """Bump namespace key version and delete legacy entries in-memory."""
        with self._lock:
            self._sync_versions_if_needed(force=True)
            ns = self._safe_namespace(namespace)
            current = self._key_versions.get(ns, 1)
            self._key_versions[ns] = current + 1

            # Merge with file state to reduce cross-process races.
            disk_versions = self._read_versions_file()
            if disk_versions:
                for disk_ns, disk_ver in disk_versions.items():
                    merged = max(int(disk_ver or 1), int(self._key_versions.get(disk_ns, 1)))
                    self._key_versions[disk_ns] = merged
                self._key_versions[ns] = max(self._key_versions.get(ns, 1), current + 1)

            try:
                self._write_versions_file(self._key_versions)
            except Exception as exc:
                self._version_sync_errors += 1
                logger.warning(f"Cache namespace version persist failed for {ns}: {exc}")

            prefix = f"{ns}:v"
            stale_keys = [k for k in self._cache.keys() if k.startswith(prefix)]
            for k in stale_keys:
                del self._cache[k]
            self._deletes += len(stale_keys)
            logger.info(f"Cache namespace invalidated: {ns} -> v{self._key_versions[ns]} ({len(stale_keys)} keys removed)")
            return len(stale_keys)

    def get_ns(self, namespace: str, key: str) -> Optional[Any]:
        self._sync_versions_if_needed()
        return self.get(self._versioned_key(namespace, key))

    def set_ns(self, namespace: str, key: str, value: Any, ttl: int = 300):
        self._sync_versions_if_needed()
        self.set(self._versioned_key(namespace, key), value, ttl)
    
    def get(self, key: str) -> Optional[Any]:
        """Get cached value if not expired"""
        with self._lock:
            if key in self._cache:
                value, expires_at = self._cache[key]
                if time.time() < expires_at:
                    self._hits += 1
                    logger.debug(f"Cache HIT: {key}")
                    return value
                else:
                    # Expired, remove it
                    del self._cache[key]
            
            self._misses += 1
            logger.debug(f"Cache MISS: {key}")
            return None
    
    def set(self, key: str, value: Any, ttl: int = 300):
        """Set cached value with TTL in seconds"""
        with self._lock:
            expires_at = time.time() + ttl
            while len(self._cache) >= self._max_entries:
                self._evict_one()
            self._cache[key] = (value, expires_at)
            self._sets += 1
            logger.debug(f"Cache SET: {key} (TTL: {ttl}s)")
    
    def delete(self, key: str):
        """Delete cached value"""
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._deletes += 1
                logger.debug(f"Cache DELETE: {key}")
    
    def clear(self):
        """Clear all cache"""
        with self._lock:
            self._cache.clear()
            self._key_versions.clear()
            self._hits = 0
            self._misses = 0
            self._sets = 0
            self._deletes = 0
            self._evictions = 0
            self._expired_removals = 0
            logger.info("Cache CLEARED")
    
    def cleanup(self):
        """Remove expired entries"""
        with self._lock:
            now = time.time()
            expired_keys = [
                key for key, (_, expires_at) in self._cache.items()
                if now >= expires_at
            ]
            for key in expired_keys:
                del self._cache[key]
            self._expired_removals += len(expired_keys)
            
            if expired_keys:
                logger.info(f"Cache cleanup: removed {len(expired_keys)} expired entries")
    
    def stats(self) -> dict:
        """Get cache statistics"""
        self._sync_versions_if_needed()
        with self._lock:
            total = self._hits + self._misses
            hit_rate = (self._hits / total * 100) if total > 0 else 0
            
            return {
                'size': len(self._cache),
                'max_entries': self._max_entries,
                'hits': self._hits,
                'misses': self._misses,
                'sets': self._sets,
                'deletes': self._deletes,
                'evictions': self._evictions,
                'expired_removed': self._expired_removals,
                'hit_rate': f"{hit_rate:.1f}%",
                'namespaces': dict(self._key_versions),
                'namespace_version_file': str(self._version_file),
                'version_sync_interval_seconds': self._version_sync_interval,
                'version_sync_errors': self._version_sync_errors,
            }


# Global cache instance
_global_cache = TTLCache()


def cache_get(key: str) -> Optional[Any]:
    """Get value from global cache"""
    return _global_cache.get(key)


def cache_get_ns(namespace: str, key: str) -> Optional[Any]:
    """Get value from namespaced global cache"""
    return _global_cache.get_ns(namespace, key)


def cache_set(key: str, value: Any, ttl: int = 300):
    """Set value in global cache"""
    _global_cache.set(key, value, ttl)


def cache_set_ns(namespace: str, key: str, value: Any, ttl: int = 300):
    """Set value in namespaced global cache"""
    _global_cache.set_ns(namespace, key, value, ttl)


def cache_delete(key: str):
    """Delete value from global cache"""
    _global_cache.delete(key)


def cache_clear():
    """Clear global cache"""
    _global_cache.clear()


def cache_make_key(namespace: str, key: str) -> str:
    """Build versioned namespaced key without writing to cache."""
    return _global_cache.make_key(namespace, key)


def cache_invalidate_namespace(namespace: str) -> int:
    """Invalidate all keys for a namespace and bump its key version."""
    return _global_cache.invalidate_namespace(namespace)


def cache_invalidate_namespaces(namespaces: list[str]) -> dict[str, int]:
    """Invalidate multiple namespaces and return removed key counts per namespace."""
    result: dict[str, int] = {}
    for ns in namespaces or []:
        ns_text = str(ns or '').strip()
        if not ns_text:
            continue
        result[ns_text] = cache_invalidate_namespace(ns_text)
    return result


def cache_stats() -> dict:
    """Get global cache statistics"""
    return _global_cache.stats()


def cached(ttl: int = 300, key_func: Optional[Callable] = None, namespace: str = 'decorator'):
    """
    Decorator for caching function results
    
    Args:
        ttl: Time to live in seconds
        key_func: Optional function to generate cache key from args
    
    Example:
        @cached(ttl=60)
        def get_gold_prices():
            return expensive_api_call()
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            if key_func:
                cache_key = key_func(*args, **kwargs)
            else:
                # Default: function name + args
                cache_key = f"{func.__name__}:{str(args)}:{str(kwargs)}"
            
            # Try to get from cache
            cached_value = _global_cache.get_ns(namespace, cache_key)
            if cached_value is not None:
                return cached_value
            
            # Execute function and cache result
            result = func(*args, **kwargs)
            _global_cache.set_ns(namespace, cache_key, result, ttl)
            
            return result
        
        return wrapper
    return decorator


# Auto-cleanup thread
def _start_cleanup_thread():
    """Start background thread to cleanup expired cache entries"""
    def cleanup_loop():
        while True:
            time.sleep(60)  # Cleanup every minute
            _global_cache.cleanup()
    
    thread = threading.Thread(target=cleanup_loop, daemon=True)
    thread.start()
    logger.info("Cache cleanup thread started")


# Start cleanup on module load
_start_cleanup_thread()
