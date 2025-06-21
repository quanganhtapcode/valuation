# 🚀 Render Deployment & Keep-Alive Setup

## 📋 Render Deployment Steps

### 1. **Chuẩn bị Repository**
```bash
# Đảm bảo có requirements.txt
pip freeze > requirements.txt

# Tạo runtime.txt (nếu cần)
echo "python-3.11.0" > runtime.txt
```

### 2. **Render Service Settings**
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python backend_server.py`
- **Environment**: `Python 3`
- **Port**: Render sẽ tự động assign

### 3. **Environment Variables**
Thêm vào Render Dashboard:
```
PYTHON_VERSION=3.11.0
```

## 🔄 Keep-Alive Solutions

### ✅ **Solution 1: UptimeRobot (Khuyến nghị)**
1. Đăng ký tại: https://uptimerobot.com
2. Tạo HTTP(s) monitor:
   - **URL**: `https://your-app-name.onrender.com/health`
   - **Interval**: 5 minutes
   - **Method**: GET

### ✅ **Solution 2: Cron-job.org**
1. Đăng ký tại: https://cron-job.org
2. Tạo job:
   - **URL**: `https://your-app-name.onrender.com/health`
   - **Schedule**: `*/10 * * * *` (mỗi 10 phút)

### ✅ **Solution 3: GitHub Actions**
File đã tạo: `.github/workflows/keep-alive.yml`
**Cần thay đổi**: `your-app-name.onrender.com` → URL thực tế

### ✅ **Solution 4: Client-side Heartbeat** 
Đã được thêm vào `app.js` - tự động ping mỗi 10 phút.

## 🎯 URL Structure

Sau khi deploy, URL sẽ có dạng:
```
https://your-app-name.onrender.com
```

Thay `your-app-name` bằng tên thực tế của service.

## 🔧 Troubleshooting

### Service Sleep Issues:
- **Render Free**: Sleep sau 15 phút không hoạt động
- **Solutions**: Sử dụng 1 trong 4 giải pháp trên
- **Best**: UptimeRobot + Client-side heartbeat

### Cold Start:
- Lần đầu wake up có thể mất 30-60 giây
- User sẽ thấy loading spinner trong thời gian này

## 💰 Cost Optimization

### Free Tier Limits:
- ⏰ **Sleep**: Sau 15 phút không hoạt động
- 🕐 **Hours**: 750 giờ/tháng (đủ cho 1 app chạy 24/7)
- 💾 **Build**: 500 build minutes/tháng

### Paid Upgrade Benefits:
- ❌ **No Sleep**: Service chạy 24/7
- ⚡ **Better Performance**: RAM và CPU cao hơn
- 🔒 **Custom Domain**: SSL miễn phí 