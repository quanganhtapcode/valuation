# Hướng dẫn Deploy Stock Valuation App

## Tổng quan
Ứng dụng Stock Valuation được deploy với:
- **Backend**: AWS EC2 (Python Flask)
- **Frontend**: Vercel (Static files)
- **API Proxy**: Vercel routes proxy API calls đến EC2

## Bước 1: Deploy Backend lên AWS EC2

### Yêu cầu
- File `key.pem` để kết nối EC2
- EC2 instance đã được khởi tạo với IP: `54.169.243.74`

### Thực hiện deploy

1. **Chuẩn bị file key:**
   ```bash
   # Đặt file key.pem trong thư mục dự án
   chmod 400 key.pem
   ```

2. **Chạy script deploy:**
   ```bash
   chmod +x connect_to_ec2.sh
   ./connect_to_ec2.sh
   ```

### Script deploy sẽ thực hiện:
- Cài đặt Python, pip, nginx
- Clone repository từ GitHub
- Tạo virtual environment
- Cài đặt dependencies
- Cấu hình systemd service
- Cấu hình nginx reverse proxy
- Khởi động services

### Kiểm tra backend
```bash
# Kiểm tra trạng thái service
sudo systemctl status valuation-backend

# Kiểm tra nginx
sudo systemctl status nginx

# Test API
curl http://54.169.243.74/health
curl http://54.169.243.74/api/stock/ACB
```

## Bước 2: Deploy Frontend lên Vercel

### Cách 1: Deploy qua Vercel CLI

1. **Cài đặt Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Login và deploy:**
   ```bash
   vercel login
   vercel --prod
   ```

### Cách 2: Deploy qua GitHub

1. **Push code lên GitHub:**
   ```bash
   git add .
   git commit -m "Add deployment config"
   git push origin main
   ```

2. **Kết nối với Vercel:**
   - Truy cập [vercel.com](https://vercel.com)
   - Import project từ GitHub
   - Vercel sẽ tự động detect và deploy

### Cấu hình Vercel
File `vercel.json` đã được tạo với:
- Static file serving cho HTML, CSS, JS
- API proxy routes đến EC2 backend
- CORS headers cho API calls

## Bước 3: Kiểm tra và Test

### Test Backend trực tiếp
```bash
# Health check
curl http://54.169.243.74/health

# Stock data
curl http://54.169.243.74/api/stock/ACB

# Current price
curl http://54.169.243.74/api/current-price/ACB
```

### Test Frontend
- Truy cập URL Vercel được cung cấp
- Test tìm kiếm cổ phiếu
- Test tính toán định giá
- Kiểm tra API calls trong Developer Tools

## Cấu trúc Deployment

```
Frontend (Vercel)
├── index.html
├── style.css
├── app.js
└── vercel.json (proxy config)

Backend (EC2)
├── backend_server.py
├── valuation_models.py
├── requirements.txt
├── industry_data/
└── nginx config
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/stock/<symbol>` | GET | Stock data |
| `/api/current-price/<symbol>` | GET | Current price |
| `/api/valuation/<symbol>` | POST | Calculate valuation |
| `/api/historical-chart-data/<symbol>` | GET | Chart data |

## Troubleshooting

### Backend Issues
```bash
# Kiểm tra logs
sudo journalctl -u valuation-backend -f

# Restart service
sudo systemctl restart valuation-backend

# Kiểm tra nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Frontend Issues
- Kiểm tra Network tab trong Developer Tools
- Verify API calls đến đúng endpoint
- Kiểm tra CORS headers

### Security Groups
Đảm bảo EC2 Security Group cho phép:
- Port 22 (SSH)
- Port 80 (HTTP)
- Port 443 (HTTPS)

## Monitoring

### Backend Monitoring
```bash
# CPU và Memory usage
htop

# Disk usage
df -h

# Service status
sudo systemctl status valuation-backend
```

### Logs
```bash
# Application logs
sudo journalctl -u valuation-backend -f

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Backup và Maintenance

### Backup Data
```bash
# Backup industry data
sudo cp -r /var/www/valuation-backend/industry_data /backup/

# Backup configuration
sudo cp /etc/nginx/sites-available/valuation-backend /backup/
sudo cp /etc/systemd/system/valuation-backend.service /backup/
```

### Update Application
```bash
# Pull latest code
cd /var/www/valuation-backend
git pull origin main

# Restart service
sudo systemctl restart valuation-backend
```

## Performance Optimization

### Nginx Optimization
- Enable gzip compression
- Configure caching headers
- Optimize worker processes

### Application Optimization
- Implement caching cho API responses
- Optimize database queries
- Use CDN cho static assets

## Security Considerations

1. **HTTPS**: Cấu hình SSL certificate
2. **Firewall**: Chỉ mở ports cần thiết
3. **Updates**: Cập nhật hệ thống thường xuyên
4. **Monitoring**: Log monitoring và alerting
5. **Backup**: Regular backup strategy 