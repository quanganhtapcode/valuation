#!/bin/bash
# Setup systemd service & timer on VPS

echo "=============================================="
echo "SETUP SYSTEMD SERVICE & TIMER"
echo "=============================================="

# 1. Copy service & timer files to systemd
echo "1. Installing service & timer files..."
sudo cp stock-fetch.service /etc/systemd/system/
sudo cp stock-fetch.timer /etc/systemd/system/

# 2. Reload systemd
echo "2. Reloading systemd daemon..."
sudo systemctl daemon-reload

# 3. Enable timer (auto-start on boot)
echo "3. Enabling timer..."
sudo systemctl enable stock-fetch.timer

# 4. Start timer
echo "4. Starting timer..."
sudo systemctl start stock-fetch.timer

# 5. Check status
echo ""
echo "=============================================="
echo "STATUS"
echo "=============================================="
sudo systemctl status stock-fetch.timer --no-pager
echo ""
echo "Next scheduled run:"
sudo systemctl list-timers stock-fetch.timer --no-pager

echo ""
echo "=============================================="
echo "COMMANDS"
echo "=============================================="
echo "Check timer status:  sudo systemctl status stock-fetch.timer"
echo "Check service logs:  sudo journalctl -u stock-fetch.service -f"
echo "Run now (manual):    sudo systemctl start stock-fetch.service"
echo "Stop timer:          sudo systemctl stop stock-fetch.timer"
echo "Disable timer:       sudo systemctl disable stock-fetch.timer"
echo ""
echo "✅ Setup completed!"
