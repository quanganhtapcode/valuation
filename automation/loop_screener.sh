#!/bin/bash
# Loop script to update VCI screening data every 30s
# Run this in tmux/screen or as a systemd service

DB="fetch_sqlite/vci_screening.sqlite"
PYTHON=".venv/bin/python"
SCRIPT="fetch_sqlite/fetch_vci_screener.py"
WORKERS=10

echo "Starting VCI Screening Data loop (30s interval)..."

while true; do
    echo "--- Fetching FULL data (no filter) ---"
    $PYTHON $SCRIPT --start-page 0 --page-size 50 --no-filter --db $DB --workers $WORKERS

    echo "--- Fetching ENRICHED data (with filter) ---"
    $PYTHON $SCRIPT --start-page 0 --page-size 50 --db $DB --workers $WORKERS

    echo "Waiting 30s..."
    sleep 30
done
