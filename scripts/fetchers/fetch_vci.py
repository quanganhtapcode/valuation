#!/usr/bin/env python3
"""Compatibility entry point for deployed index-history cron commands."""

if __package__:
    from .fetch_vci_index_history import main
else:
    from fetch_vci_index_history import main


if __name__ == "__main__":
    raise SystemExit(main())
