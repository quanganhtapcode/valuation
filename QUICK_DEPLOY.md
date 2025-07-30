# 🚀 Quick Deploy Guide

## Deploy nhanh trong 3 bước

### Bước 1: Chuẩn bị
```bash
# Đặt file key.pem trong thư mục dự án
# Đảm bảo có quyền truy cập GitHub repository
```

### Bước 2: Deploy Backend
```bash
# Chạy script deploy tự động
chmod +x deploy_all.sh
./deploy_all.sh
```

### Bước 3: Deploy Frontend
```bash
# Cách 1: Vercel CLI
npm install -g vercel
vercel login
vercel --prod

# Cách 2: GitHub Integration
# Truy cập https://vercel.com
# Import: https://github.com/quanganhtapcode/val.git
```

## 🔗 URLs sau khi deploy

- **Backend API**: http://54.169.243.74
- **Frontend**: [Vercel URL]
- **Health Check**: http://54.169.243.74/health

## 📊 Test API

```bash
# Health check
curl http://54.169.243.74/health

# Stock data
curl http://54.169.243.74/api/stock/ACB

# Current price
curl http://54.169.243.74/api/current-price/ACB
```

## 🛠️ Troubleshooting

```bash
# Kiểm tra trạng thái
./check_deployment.sh

# Restart backend
ssh -i key.pem ubuntu@54.169.243.74
sudo systemctl restart valuation-backend
```

## 📝 Notes

- Backend chạy trên port 5000 (internal)
- Nginx proxy port 80 → 5000
- CORS đã được cấu hình cho tất cả origins
- Rate limiting: 10 req/s cho API, 30 req/s cho general 