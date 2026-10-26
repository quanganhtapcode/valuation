# Quy ước và cấu trúc code

## Frontend

```text
frontend-next/src/
  app/                  Next.js routes và route entry points
  components/
    layout/             Navbar, Footer, MainWrapper
    ui/                 Button, Pagination, error boundaries, DeferredPanel
    HeroIndexCard/      Card chỉ số và modal lịch sử của card
    StockDetail/        Các tab và biểu đồ của trang cổ phiếu
    Macro/              Các thành phần dữ liệu vĩ mô
    ...                 Component theo chức năng
  hooks/                useScroll, useOkxTickers, useVisiblePolling
  contexts/             LanguageContext, WatchlistContext
  config/               siteConfig
  lib/                  API clients, types, formatters, nội dung và utility
```

- File component và provider dùng PascalCase, ví dụ `HeroIndexCard.tsx`,
  `LanguageContext.tsx`; tên component khớp với file khi có một component chính.
- Hook dùng camelCase bắt đầu bằng `use`, ví dụ `useVisiblePolling.ts`.
- API client, formatter, utility và file dữ liệu dùng camelCase. Giữ hậu tố
  `.server.ts` cho code chỉ chạy phía server.
- `index.ts` chỉ dùng làm entry point/re-export; phần triển khai React đặt trong
  file có tên cụ thể. Các file đặc biệt của Next.js như `page.tsx`, `layout.tsx`,
  `loading.tsx`, `error.tsx`, `route.ts` giữ tên theo framework.
- Component dùng riêng cho một chức năng đặt cạnh nhau; UI dùng chung đặt trong
  `components/ui`, khung trang đặt trong `components/layout`.
- Ưu tiên alias `@/`; ESLint ngăn import trở lại các vị trí cũ của hook, context,
  layout và cấu hình website.

## Python và vận hành

```text
backend/
  routes/               Flask route registration và HTTP handlers
  services/             Nghiệp vụ và dịch vụ dữ liệu
  data_sources/         Các client thị trường
  updater/              Batch jobs dùng trực tiếp dịch vụ backend
scripts/
  fetchers/             Crawler theo nguồn và loại dữ liệu
  financials/
    storage.py          Ghi báo cáo tài chính, provenance và quyền sở hữu dữ liệu
    import_ssi.py       Nhập JSONL SSI vào SQLite
    merge_ssi.py        Ghép dữ liệu SSI vào dữ liệu Vietcap
automation/             Lịch chạy, service/timer, backup và script vận hành
tests/                  Test Python chạy offline bằng database tạm/mock HTTP
```

- Tên module, hàm và biến dùng snake_case; class dùng PascalCase, hằng số dùng
  UPPER_SNAKE_CASE; thụt đầu dòng bằng 4 dấu cách.
- Crawler dùng `fetch_<source>_<dataset>.py`. Ví dụ crawler chỉ số nằm trong
  `scripts/fetchers/fetch_vci_index_history.py`; cron và installer đều gọi tên cụ thể.
- Job chỉ số hằng ngày trong installer dùng `--incremental`: bắt đầu từ trang
  mới nhất, đọc đến mốc dữ liệu đã có và làm mới chồng lấn 7 ngày. Crawler kiểm
  tra thứ tự ngày, không báo thành công khi phản hồi API lỗi hoặc giới hạn trang
  chưa phủ được khoảng thiếu. Chạy không có cờ để backfill/refresh lịch sử cũ.
- Công cụ xử lý dữ liệu offline không đặt lẫn trong `fetchers`. CLI mới:

  ```bash
  .venv/bin/python -m scripts.financials.import_ssi --help
  .venv/bin/python -m scripts.financials.merge_ssi --help
  .venv/bin/python scripts/fetchers/fetch_vci_index_history.py --help
  ```

- Service/timer giữ tên đã triển khai. Đổi tên script mà systemd/cron đang gọi
  cần cập nhật cấu hình triển khai hoặc giữ entry point tương thích.
- File SQLite, WAL/SHM, cache, token và dữ liệu runtime không thuộc module code.

## Kết quả rà soát và phạm vi

Các tên file Python hiện có đã dùng snake_case. Những thay đổi cấu trúc tập
trung vào tên crawler chỉ số, ranh giới crawler/importer và cách phân loại
hook/context/layout của React. Import và CLI đã được cập nhật đồng bộ.

Một số module còn lớn: `reportGenerator.ts`, `FinancialsTab.tsx`,
`download_routes.py`, `valuation_service.py`, `fetch_vci_financial_statement.py`.
Chúng cần một đợt tách theo trách nhiệm và kiểm tra hợp đồng dữ liệu riêng;
không nên chỉ chia file theo số dòng. `missing_routes.py` cũng chứa nhiều nhóm
endpoint và nên tách theo catalogue, báo cáo và valuation khi refactor phần API.

Hook `useScroll` chỉ cập nhật React state khi vượt qua hoặc trở lại dưới ngưỡng,
tránh gọi state setter ở mỗi scroll event. Chưa đo FPS hoặc thời gian tải trên
trình duyệt thực tế. Giảm request của crawler chỉ số đã được kiểm tra offline
với trang chồng lấn, khoảng thiếu nhiều trang và database mới; chưa benchmark
API production. Cấu hình cron mới cần được cài lại để có hiệu lực.

Đợt thay đổi này giữ hành vi API, schema/database và giao diện. Không chạy
import/merge dữ liệu production hay cài lại cron/systemd khi kiểm tra cấu trúc.
