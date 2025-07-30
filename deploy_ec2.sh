#!/bin/bash

# Script deploy backend lên AWS EC2
# Sử dụng: ./deploy_ec2.sh

echo "=== Bắt đầu deploy backend lên AWS EC2 ==="

# Cập nhật hệ thống
echo "Cập nhật hệ thống..."
sudo apt-get update
sudo apt-get upgrade -y

# Cài đặt Python và pip
echo "Cài đặt Python và pip..."
sudo apt-get install -y python3 python3-pip python3-venv

# Cài đặt nginx
echo "Cài đặt nginx..."
sudo apt-get install -y nginx

# Tạo thư mục cho ứng dụng
echo "Tạo thư mục ứng dụng..."
sudo mkdir -p /var/www/valuation-backend
sudo chown $USER:$USER /var/www/valuation-backend

# Clone repository từ GitHub
echo "Clone repository từ GitHub..."
cd /var/www/valuation-backend
git clone https://github.com/quanganhtapcode/val.git .

# Tạo virtual environment
echo "Tạo virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Cài đặt dependencies
echo "Cài đặt Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Cài đặt gunicorn nếu chưa có
pip install gunicorn

# Tạo file systemd service
echo "Tạo systemd service..."
sudo tee /etc/systemd/system/valuation-backend.service > /dev/null <<EOF
[Unit]
Description=Valuation Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/valuation-backend
Environment=PATH=/var/www/valuation-backend/venv/bin
ExecStart=/var/www/valuation-backend/venv/bin/gunicorn --workers 3 --bind 0.0.0.0:5000 backend_server:app
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Cấu hình nginx
echo "Cấu hình nginx..."
sudo tee /etc/nginx/sites-available/valuation-backend > /dev/null <<EOF
server {
    listen 80;
    server_name 54.169.243.74;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # CORS headers
    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
    add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;

    if (\$request_method = 'OPTIONS') {
        add_header 'Access-Control-Allow-Origin' '*';
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS';
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization';
        add_header 'Access-Control-Max-Age' 1728000;
        add_header 'Content-Type' 'text/plain; charset=utf-8';
        add_header 'Content-Length' 0;
        return 204;
    }
}
EOF

# Kích hoạt site nginx
sudo ln -sf /etc/nginx/sites-available/valuation-backend /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Kiểm tra cấu hình nginx
sudo nginx -t

# Khởi động và enable services
echo "Khởi động services..."
sudo systemctl daemon-reload
sudo systemctl enable valuation-backend
sudo systemctl start valuation-backend
sudo systemctl restart nginx

# Cấu hình firewall
echo "Cấu hình firewall..."
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

echo "=== Deploy hoàn tất! ==="
echo "Backend URL: http://54.169.243.74"
echo "API Endpoints:"
echo "  - GET http://54.169.243.74/api/stock/<symbol>"
echo "  - GET http://54.169.243.74/api/current-price/<symbol>"
echo "  - POST http://54.169.243.74/api/valuation/<symbol>"
echo "  - GET http://54.169.243.74/health"

# Kiểm tra trạng thái services
echo "Kiểm tra trạng thái services..."
sudo systemctl status valuation-backend --no-pager
sudo systemctl status nginx --no-pager 