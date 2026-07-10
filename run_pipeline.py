#!/usr/bin/env python3
"""Refresh derived data that is not owned by the ingestion cron jobs.

Canonical SQLite fetchers are scheduled by automation/setup_cron_vps.sh.
This systemd entrypoint only rebuilds the security universe and valuation cache,
so it does not duplicate price, news, company, or financial-statement fetches.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.cache_utils import cache_invalidate_namespaces
from backend.security_master import refresh_security_master
from backend.updater.batch_valuations import run_batch_valuations


BASE_DIR = Path(__file__).resolve().parent
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOGS_DIR / "pipeline.log"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)


def step_refresh_security_master() -> bool:
    try:
        summary = refresh_security_master()
        logger.info(
            "Security master refreshed: active=%d inactive=%d total=%d",
            summary["active"],
            summary["inactive"],
            summary["total"],
        )
        cache_invalidate_namespaces(["stock_routes", "source_priority", "decorator"])
        return True
    except Exception:
        logger.exception("Security master refresh failed")
        return False


def step_batch_valuations() -> bool:
    try:
        result = run_batch_valuations()
        logger.info(
            "Batch valuations finished: computed=%d skipped=%d errors=%d total=%d",
            result["computed"],
            result["skipped"],
            result["errors"],
            result["total"],
        )
        return True
    except Exception:
        logger.exception("Batch valuation refresh failed")
        return False


def main() -> int:
    logger.info("Starting derived-data maintenance")
    if not step_refresh_security_master():
        return 1

    if not step_batch_valuations():
        return 1

    logger.info("Derived-data maintenance completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
