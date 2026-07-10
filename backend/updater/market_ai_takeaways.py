from __future__ import annotations

import argparse
import json

from backend.services.market_ai_takeaways import refresh_market_ai_takeaways


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the shared AI market-takeaways snapshot.")
    parser.add_argument("--refresh", action="store_true", help="Generate and persist a fresh snapshot.")
    args = parser.parse_args()
    if not args.refresh:
        parser.error("--refresh is required")
    data = refresh_market_ai_takeaways()
    print(json.dumps({
        "available": data.get("available"),
        "model": data.get("model"),
        "generated_at": data.get("generated_at"),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
