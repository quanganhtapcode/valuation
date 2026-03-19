from __future__ import annotations

from typing import Any, Callable


_cache_func: Callable[..., Any] | None = None
_cache_ttl: dict[str, int] | None = None
_gold_service: Any | None = None


def set_deps(*, get_cached_func: Callable[..., Any], cache_ttl: dict[str, int], gold_service: Any) -> None:
    global _cache_func, _cache_ttl, _gold_service
    _cache_func = get_cached_func
    _cache_ttl = cache_ttl
    _gold_service = gold_service


def cache_func() -> Callable[..., Any]:
    if _cache_func is None:
        raise RuntimeError("Market deps not initialized: cache_func")
    return _cache_func


def cache_ttl() -> dict[str, int]:
    return _cache_ttl or {}


def gold_service() -> Any:
    if _gold_service is None:
        raise RuntimeError("Market deps not initialized: gold_service")
    return _gold_service
