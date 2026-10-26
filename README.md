# Quang Anh Stocks

Nền tảng nghiên cứu và định giá cổ phiếu Việt Nam: tổng quan thị trường, bộ lọc,
báo cáo tài chính, lịch sử giá, định giá, dữ liệu vĩ mô và tin tức.

## Kiến trúc

- Frontend: Next.js, React và TypeScript trong `frontend-next/`; triển khai riêng trên Vercel.
- Backend: Flask, Gunicorn/gevent và SQLite trên VPS tại `/var/www/valuation`.
- HTTP: trình duyệt gọi `/api/...` cùng domain; Next.js chuyển tiếp tới backend.
- WebSocket: kết nối trực tiếp tới `wss://api.quanganh.org/v1/valuation/ws/...`.
- Production: `valuation.service` phục vụ `127.0.0.1:8000`, Nginx công bố `/v1/valuation/`.

## Cấu trúc

| Đường dẫn | Nội dung |
| --- | --- |
| `frontend-next/` | Giao diện, API proxy và kiểm thử frontend |
| `backend/` | API, nghiệp vụ, client dữ liệu và batch updater |
| `scripts/fetchers/` | Bộ thu thập dữ liệu theo nguồn |
| `scripts/financials/` | Nhập và ghép dữ liệu báo cáo tài chính |
| `automation/` | Cron, systemd, backup và công cụ bảo trì |
| `data/sqlite/` | Database production; không commit hoặc xoá khi dọn source |
| `data/financial-statements/` | Tệp dữ liệu báo cáo tải về |
| `logs/`, `runtime/` | Nhật ký, cache và trạng thái vận hành |
| `tests/` | Kiểm thử Python với database tạm và HTTP giả lập |
| `docs/` | [Danh mục tài liệu kỹ thuật](docs/README.md) |

## Cài đặt và chạy local

VPS hiện dùng Python 3.14 và Node.js 22. Tạo môi trường riêng khi phát triển;
không cài đè dependency hoặc chạy pipeline ghi dữ liệu để thử tài liệu trên production.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend-next
npm ci
cp .env.example .env.local
```

Cấu hình `.env` cho backend và `frontend-next/.env.local` cho frontend theo môi trường.
Không commit `.env`, token, thông tin tài khoản dịch vụ hoặc dữ liệu production.

Từ thư mục gốc, chạy backend trong một terminal:

```bash
.venv/bin/gunicorn --worker-class gevent --workers 2 --bind 127.0.0.1:8000 backend.server:app
```

Trong terminal khác:

```bash
cd frontend-next
npm run dev
```

Chi tiết kết nối và biến môi trường: [README frontend](frontend-next/README.md).

## Vận hành VPS

```bash
systemctl status valuation.service
journalctl -u valuation.service -n 50 --no-pager
curl -sS http://127.0.0.1:8000/api/health
systemctl list-timers --all
crontab -l
```

Health check có thể trả `207` khi dịch vụ hoạt động nhưng dữ liệu hoặc ingestion
cần được kiểm tra. Xem từng mục trong JSON; không coi cảnh báo dữ liệu cũ là lỗi CPU/RAM.

- `automation/setup_cron_vps.sh --dry-run` chỉ hiển thị cron dự kiến.
- `automation/vci_safe_run.sh` dùng khóa database, SQLite snapshot và kiểm tra chất lượng.
- Exit code `75` của ingestion nghĩa là còn phần chưa hoàn tất; dữ liệu thành công được giữ.
- Financials dùng `--resume-missing --resume-since-hours 144`; có lịch lấy bù các đêm tiếp theo.
- News/events lưu vị trí tiếp tục để lỗi ở một số mã không chặn mọi mã phía sau.
- `run_pipeline.py` cập nhật dữ liệu dẫn xuất và có ghi database; đây không phải lệnh test offline.
- `fetch_vci_financial_data.py` vẫn được bot Excel import cho dữ liệu dự báo có bearer token.

## Quy ước tên và endpoint

File Python dùng `snake_case`, component React dùng `PascalCase`; module route đặt
theo tài nguyên (`companies.py`, `financials.py`, `metrics.py`, `peers.py`).
Các URL dùng danh từ, chữ thường và gạch nối. Một số đường dẫn chính:

| Tài nguyên | URL |
| --- | --- |
| Báo cáo tài chính | `/api/stocks/{symbol}/financials` |
| Chỉ số tài chính | `/api/stocks/{symbol}/metrics` |
| Xuất báo cáo | `/api/exports/financials` |
| Danh mục workbook | `/api/workbooks` |
| Thống kê database | `/api/stats/database` |

URL cũ tiếp tục dùng cùng handler, method và chính sách cache. Xem
[hợp đồng API](docs/api-contract.md) để biết query và schema của từng tài nguyên.

## Kiểm tra chất lượng

Từ thư mục gốc:

```bash
.venv/bin/python -m unittest discover -s tests
```

Frontend:

```bash
cd frontend-next
npm run lint
npm test
npm run build
```

## Dữ liệu và khôi phục

Xem [backup/restore](docs/valuation-data-backup.md),
[bảo trì SQLite](docs/sqlite-maintenance.md) và [danh mục dữ liệu](docs/data-inventory.md).
Không xoá WAL/SHM, lock, database hoặc bản sao lưu chỉ vì không được Git quản lý.
Các báo cáo kiểm tra theo ngày và hồ sơ migration cũ đã được đưa ra khỏi cây source;
tài liệu hiện hành nằm trong `docs/`.

## Giấy phép và phạm vi sử dụng

Source sử dụng [giấy phép MIT](LICENSE). Dữ liệu và phân tích phục vụ nghiên cứu;
người sử dụng cần tự xác minh thông tin trước khi đưa ra quyết định đầu tư.
