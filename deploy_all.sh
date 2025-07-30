#!/bin/bash

# Script deploy toàn bộ ứng dụng
# Sử dụng: ./deploy_all.sh

echo "=== Deploy Stock Valuation App ==="

# Kiểm tra file key
if [ ! -f "key.pem" ]; then
    echo "❌ File key.pem không tồn tại!"
    echo "Vui lòng đặt file key.pem trong thư mục hiện tại"
    exit 1
fi

# Cấp quyền cho key file
chmod 400 key.pem

echo "📤 Push code lên GitHub..."
git add .
git commit -m "Add deployment configuration for EC2 and Vercel"
git push origin main

echo "🚀 Deploy Backend lên EC2..."
chmod +x connect_to_ec2.sh
./connect_to_ec2.sh

echo "⏳ Chờ backend khởi động..."
sleep 30

echo "🔍 Kiểm tra backend..."
chmod +x check_deployment.sh
./check_deployment.sh

echo ""
echo "🌐 Deploy Frontend lên Vercel..."
echo "Có 2 cách để deploy frontend:"
echo ""
echo "Cách 1: Deploy qua Vercel CLI"
echo "1. Cài đặt Vercel CLI: npm install -g vercel"
echo "2. Login: vercel login"
echo "3. Deploy: vercel --prod"
echo ""
echo "Cách 2: Deploy qua GitHub"
echo "1. Truy cập https://vercel.com"
echo "2. Import project từ GitHub: https://github.com/quanganhtapcode/val.git"
echo "3. Vercel sẽ tự động detect và deploy"
echo ""

echo "✅ Deploy hoàn tất!"
echo ""
echo "📊 Deployment Summary:"
echo "Backend: http://54.169.243.74"
echo "Frontend: [Vercel URL sẽ được cung cấp sau khi deploy]"
echo ""
echo "🔗 API Endpoints:"
echo "  - GET http://54.169.243.74/health"
echo "  - GET http://54.169.243.74/api/stock/<symbol>"
echo "  - GET http://54.169.243.74/api/current-price/<symbol>"
echo "  - POST http://54.169.243.74/api/valuation/<symbol>"
echo ""
echo "📝 Next Steps:"
echo "1. Deploy frontend lên Vercel"
echo "2. Test toàn bộ ứng dụng"
echo "3. Cấu hình domain nếu cần"
echo "4. Setup monitoring và logging" 