#!/bin/bash

# Script kiểm tra trạng thái deployment
# Sử dụng: ./check_deployment.sh

EC2_IP="54.169.243.74"
KEY_FILE="key.pem"

echo "=== Kiểm tra trạng thái Deployment ==="

# Kiểm tra kết nối EC2
echo "🔍 Kiểm tra kết nối EC2..."
if ping -c 1 $EC2_IP > /dev/null 2>&1; then
    echo "✅ EC2 instance có thể truy cập"
else
    echo "❌ Không thể kết nối đến EC2 instance"
    exit 1
fi

# Kiểm tra backend services
echo "🔍 Kiểm tra backend services..."
ssh -i $KEY_FILE ubuntu@$EC2_IP << 'EOF'
    echo "=== Backend Services Status ==="
    
    # Kiểm tra systemd service
    echo "📊 Valuation Backend Service:"
    sudo systemctl status valuation-backend --no-pager
    
    echo ""
    echo "🌐 Nginx Service:"
    sudo systemctl status nginx --no-pager
    
    echo ""
    echo "💾 Disk Usage:"
    df -h
    
    echo ""
    echo "🧠 Memory Usage:"
    free -h
    
    echo ""
    echo "🔥 CPU Usage:"
    top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
EOF

# Test API endpoints
echo "🔍 Test API endpoints..."
echo "Health Check:"
curl -s http://$EC2_IP/health | jq . 2>/dev/null || curl -s http://$EC2_IP/health

echo ""
echo "Stock Data Test (ACB):"
curl -s http://$EC2_IP/api/stock/ACB | jq '.symbol, .name, .current_price' 2>/dev/null || curl -s http://$EC2_IP/api/stock/ACB

echo ""
echo "Current Price Test (ACB):"
curl -s http://$EC2_IP/api/current-price/ACB | jq . 2>/dev/null || curl -s http://$EC2_IP/api/current-price/ACB

# Kiểm tra logs
echo ""
echo "🔍 Kiểm tra logs gần đây..."
ssh -i $KEY_FILE ubuntu@$EC2_IP << 'EOF'
    echo "=== Recent Application Logs ==="
    sudo journalctl -u valuation-backend --since "10 minutes ago" --no-pager
    
    echo ""
    echo "=== Recent Nginx Error Logs ==="
    sudo tail -n 20 /var/log/nginx/error.log
    
    echo ""
    echo "=== Recent Nginx Access Logs ==="
    sudo tail -n 10 /var/log/nginx/access.log
EOF

echo ""
echo "=== Tóm tắt Deployment ==="
echo "🌐 Backend URL: http://$EC2_IP"
echo "📊 API Endpoints:"
echo "   - GET http://$EC2_IP/health"
echo "   - GET http://$EC2_IP/api/stock/<symbol>"
echo "   - GET http://$EC2_IP/api/current-price/<symbol>"
echo "   - POST http://$EC2_IP/api/valuation/<symbol>"
echo ""
echo "✅ Kiểm tra hoàn tất!" 