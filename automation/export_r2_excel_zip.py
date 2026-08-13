#!/usr/bin/env python3
"""Create a streaming ZIP backup of all Vietcap Excel files stored in R2."""

from __future__ import annotations

import argparse
import os
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "backups"
CHUNK_SIZE = 1024 * 1024

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download all R2 Excel objects into one ZIP archive."
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Destination ZIP path (defaults to backups/vietcap-excel-<UTC timestamp>.zip).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(PROJECT_ROOT / ".env")

    from backend.r2_client import get_r2_client

    r2_client = get_r2_client()
    if not r2_client.is_configured:
        print("R2 is not configured.", file=sys.stderr)
        return 1

    output = args.output or (
        DEFAULT_OUTPUT_DIR
        / f"vietcap-excel-{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}.zip"
    )
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_suffix(output.suffix + ".partial")
    if temporary_output.exists():
        temporary_output.unlink()

    prefix = f"{r2_client.excel_folder}/"
    continuation_token: str | None = None
    object_count = 0
    bytes_written = 0

    try:
        with zipfile.ZipFile(
            temporary_output,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            while True:
                request = {
                    "Bucket": r2_client.bucket_name,
                    "Prefix": prefix,
                    "MaxKeys": 1000,
                }
                if continuation_token:
                    request["ContinuationToken"] = continuation_token
                page = r2_client._client.list_objects_v2(**request)

                for item in page.get("Contents", []):
                    key = item["Key"]
                    if not key.endswith(".xlsx"):
                        continue
                    response = r2_client._client.get_object(
                        Bucket=r2_client.bucket_name, Key=key
                    )
                    with response["Body"] as source, archive.open(key, "w") as target:
                        while chunk := source.read(CHUNK_SIZE):
                            target.write(chunk)
                            bytes_written += len(chunk)
                    object_count += 1
                    if object_count % 100 == 0:
                        print(f"Archived {object_count} files...", flush=True)

                if not page.get("IsTruncated"):
                    break
                continuation_token = page["NextContinuationToken"]

        if not object_count:
            print("No .xlsx objects found in R2; archive was not created.", file=sys.stderr)
            temporary_output.unlink(missing_ok=True)
            return 1
        os.replace(temporary_output, output)
    except Exception:
        temporary_output.unlink(missing_ok=True)
        raise

    print(f"Created: {output}")
    print(f"Files: {object_count}")
    print(f"Source bytes: {bytes_written}")
    print(f"ZIP bytes: {output.stat().st_size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
