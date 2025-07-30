#!/bin/bash

# Script kết nối và deploy lên EC2
# Sử dụng: ./connect_to_ec2.sh

EC2_IP="54.169.243.74"
KEY_FILE="key.pem"

echo "=== Kết nối và deploy lên EC2 ==="

# Kiểm tra file key
if [ ! -f "$KEY_FILE" ]; then
    echo "❌ File key.pem không tồn tại!"
    echo "Vui lòng đặt file key.pem trong thư mục hiện tại"
    exit 1
fi

# Cấp quyền cho key file
chmod 400 $KEY_FILE

echo "🔑 Kết nối đến EC2 instance..."
ssh -i $KEY_FILE ubuntu@$EC2_IP << 'EOF'
    echo "✅ Đã kết nối thành công đến EC2"
    
    # Tạo thư mục tạm để chứa script deploy
    mkdir -p ~/deploy-temp
    cd ~/deploy-temp
EOF

echo "📤 Upload script deploy lên EC2..."
scp -i $KEY_FILE deploy_ec2.sh ubuntu@$EC2_IP:~/deploy-temp/

echo "🚀 Chạy script deploy trên EC2..."
ssh -i $KEY_FILE ubuntu@$EC2_IP << 'EOF'
    cd ~/deploy-temp
    chmod +x deploy_ec2.sh
    ./deploy_ec2.sh
EOF

echo "✅ Deploy hoàn tất!"
echo "🌐 Backend URL: http://$EC2_IP"
echo "📊 API Endpoints:"
echo "   - GET http://$EC2_IP/api/stock/<symbol>"
echo "   - GET http://$EC2_IP/api/current-price/<symbol>"
echo "   - POST http://$EC2_IP/api/valuation/<symbol>"
echo "   - GET http://$EC2_IP/health" 