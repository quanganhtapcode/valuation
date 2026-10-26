# Quy ước API công khai

Frontend gọi REST qua cùng origin `/api`; Next.js chuyển tiếp tới backend. Các đường dẫn trong tài liệu dùng tiền tố này. WebSocket giữ cấu hình riêng.

## Đặt tên và tương thích

- Dùng danh từ số nhiều cho tập tài nguyên: `/stocks`, `/companies`, `/financials`.
- Đặt mã chứng khoán trước tài nguyên con: `/stocks/{symbol}/price-history`. Chuẩn hóa mã thành chữ hoa và mã hóa bằng `encodeURIComponent` khi tạo URL.
- Dùng chữ thường và dấu gạch nối; tên công khai mô tả dữ liệu, không phụ thuộc nhà cung cấp như `vci` hoặc `fireant`.
- Dùng query cho bộ lọc, khoảng thời gian và phân trang. GET đọc dữ liệu; POST tính định giá với giả định trong JSON body.
- Các URL dài trước đây (`/stocks/{symbol}/financial-statements`, `/financial-statements/exports`, `/financial-statements/workbooks/manifest`) tiếp tục hoạt động. Tên hiện hành lần lượt là `/stocks/{symbol}/financials`, `/exports/financials` và `/workbooks`.
- Giữ URL cũ làm alias để client đang chạy tiếp tục hoạt động. Alias dùng cùng handler, HTTP method, validation và giới hạn tải; không chuyển hướng HTTP.
- Code mới chỉ dùng đường dẫn chuẩn. Không thêm đường dẫn cũ vào component hoặc tạo thêm tên đồng nghĩa. Manifest chung nằm tại [apiRouteAliases.json](../frontend-next/src/lib/apiRouteAliases.json), được cả backend và proxy đọc; URL của frontend tập trung tại [apiCore.ts](../frontend-next/src/lib/apiCore.ts).

## Cổ phiếu và doanh nghiệp

Các đường dẫn dưới đây là GET, trừ nơi ghi method khác. `{symbol}` minh họa bằng `FPT`.

| Đường dẫn chuẩn | Tham số chính | Response thành công |
| --- | --- | --- |
| `/api/stocks/{symbol}` | `period=year\|quarter`, `fetch_price=true` nếu cần giá mới | Object phẳng gồm thông tin cổ phiếu, chỉ số và lịch sử |
| `/api/stocks/{symbol}/summary` | `realtime=0` để chỉ lấy dữ liệu nền | Object phẳng: `success`, `symbol`, thông tin cơ bản, giá và chỉ số chính |
| `/api/stocks/{symbol}/profile` | — | Object phẳng: `success`, `symbol`, `name`, `exchange`, `industry`, `company_profile` |
| `/api/companies/{symbol}/profile` | — | Hồ sơ xuất sẵn: `company_name`, `company_profile`, `history`, vốn điều lệ…; khác schema của stock profile |
| `/api/companies/{symbol}/description` | `lang=vi\|en` | `{ available, profile, source }`, mô tả đa ngôn ngữ từ Next.js |
| `/api/stocks/{symbol}/overview` | — | Object gộp summary, profile và các chuỗi chỉ số |
| `/api/stocks/{symbol}/quote` | — | Object phẳng: `success`, `symbol`, `current_price`, thay đổi giá, khối lượng, `orderbook`… |
| `/api/stocks/quotes` | `symbols=FPT,VCB` | Object theo mã: `{ "FPT": { "price": …, "changePercent": …, "companyName": …, "exchange": … } }` |
| `/api/stocks/overviews` | `symbols=FPT,VCB` | Object theo mã chứa overview tương ứng |
| `/api/stocks/{symbol}/price-history` | `period=1M\|3M\|6M\|1Y\|2Y\|3Y\|5Y\|ALL` | `{ success, symbol, data: […], count, source, latest_date }` |
| `/api/stocks/{symbol}/valuation-history` | `limit`, tối đa 250 | `{ success, symbol, period, source, count, data: […] }`, chỉ số PE/PB theo ngày |
| `/api/stocks/{symbol}/chart-data` | `period=quarter\|year` | `{ success, symbol, period, count, data: […] }`, chỉ số tài chính theo kỳ |
| `/api/stocks/{symbol}/ratio-history`, `/ratio-series` | — | Object chứa các chuỗi chỉ số phục vụ biểu đồ |
| `/api/stocks/{symbol}/financials` | `type=income\|balance\|cashflow\|ratio\|note`, `period=quarter\|year`, `limit` | Mảng bản ghi trực tiếp; mỗi bản ghi gồm kỳ báo cáo và các trường tài chính |
| `/api/stocks/{symbol}/financials/fields` | `type` | `{ data: […], field_map, field_map_en }`, nhãn và cấu trúc trường |
| `/api/stocks/{symbol}/metrics` | — | `{ success, symbol, data: […] }`, bản ghi chỉ số gần nhất |
| `/api/stocks/metrics` | `icb_l3` nếu lọc ngành | `{ success, count, icb_l3, data: […] }` |
| `/api/stocks/metrics/sectors` | — | `{ success, sectors: […] }` |
| `/api/stocks/{symbol}/news` | `compact=1` để giảm trường không cần cho danh sách | `{ success, data: […] }` |
| `/api/stocks/{symbol}/events`, `/feed` | Feed dùng `tab` | Object chứa `data` và thông tin snapshot như `stale`, `partial`, `refresh_pending` khi có |
| `/api/stocks/{symbol}/peers` | — | `{ success, data: […] }` |
| `/api/stocks/{symbol}/peer-valuations` | `mode=quarter\|year` | `{ success, data: […], medianPe, industry, period }` |
| POST `/api/stocks/{symbol}/valuation` | JSON body chứa giả định định giá | Kết quả từ dịch vụ định giá, giữ schema từng mô hình |
| GET/POST `/api/stocks/{symbol}/valuation/sensitivity` | Giả định và khoảng biến thiên | Ma trận độ nhạy định giá |
| `/api/companies`, `/api/companies/search` | Danh sách: `exchange`, `page`, `limit`; tìm kiếm: `q`, `limit` | Mảng doanh nghiệp trực tiếp |

Các tài nguyên cổ phiếu khác dùng cùng cấu trúc tên: `/shareholders`, `/financial-dashboard`, `/revenue-profit`, `/loan-breakdown`, `/technical`, `/technical/{timeframe}`, `/ai-analysis`, `/freshness`. Giữ nguyên schema của từng endpoint; `/ai-analysis` có thể trả `available: false` khi chưa có bài phân tích.

## Thị trường và tải dữ liệu

| Đường dẫn chuẩn | Nội dung / response chính |
| --- | --- |
| `/api/market/indices` | Mảng snapshot chỉ số; thay tên phụ thuộc nguồn `/market/vci-indices` |
| `/api/market/indices/history?index=VNINDEX&days=30` | Mảng lịch sử chỉ số; `compact=1` chỉ giữ ngày, điểm đóng cửa và khối lượng |
| `/api/market/index-valuations` | Lịch sử PE/PB của chỉ số; query `index`, `metric`, `timeFrame` |
| `/api/market/overview` | Object gộp `watchlistPrices`, biểu đồ định giá, tin tức và heatmap; lọc bằng `symbols`, `news_size`, `heatmap_limit`… |
| `/api/market/macro/gdp` | Object các chỉ tiêu GDP và thương mại |
| `/api/market/macro/indicators` | Object chỉ tiêu vĩ mô theo nhóm; query `types=GDP,Trade`, `full=1` |
| `/api/market/news` | `{ success, data: […] }`; query `page`, `size`, `compact=1` |
| `/api/market/funds` | `{ success, data: […], count, fetched_at, source, stale? }` |
| `/api/market/funds/{symbol}` | `{ success, fund, history, yearly_returns, … }` |
| `/api/financials/years` | `{ first_year, last_year }` |
| `/api/financials/fields` | Bảng mã trường tài chính do Next.js phục vụ |
| `/api/exports/financials` | File báo cáo theo phạm vi lựa chọn; giữ `Content-Type` và `Content-Disposition` |
| `/api/workbooks` | `{ success, files: […], count, missing }`, URL tải workbook gốc |
| `/api/workbooks/archive` | File ZIP chứa workbook gốc |
| `/api/stocks/{symbol}/workbook` | Object chứa URL workbook gốc |
| `/api/stocks/{symbol}/report` | Tải báo cáo của một mã |
| `/api/stats/database` | Thống kê database; tương thích `/api/db/stats` |
| `/api/health` | Trạng thái sức khỏe dịch vụ và dữ liệu |

Các tên đã rõ nghĩa như `/market/screener`, `/market/heatmap`, `/market/top-movers`, `/market/foreign-flow`, `/market/world-indices`, `/market/events`, `/market/earnings-releases`, `/market/macro/rates` tiếp tục được sử dụng.

## JSON và lỗi

Response thành công giữ schema theo endpoint để tương thích: có endpoint trả object phẳng, có endpoint trả mảng, có endpoint dùng `{ success, data }`. Việc chuẩn hóa tên URL không tự bọc thêm một lớp `data` hay đổi tên tất cả trường. Khi đổi schema sau này, phải cập nhật type, client và kiểm thử tương ứng.

JSON dùng UTF-8 và dạng gọn mặc định. Chỉ thêm `?pretty=1` khi cần thụt dòng để đọc; User-Agent của curl hay trình duyệt không làm thay đổi cách định dạng.

Lỗi HTTP dùng cùng cấu trúc tại backend và proxy:

```json
{"success":false,"error":{"code":"NOT_FOUND","message":"Symbol not found"}}
```

HTTP status giữ nguyên ý nghĩa: 400 dữ liệu đầu vào sai, 404 không tìm thấy, 405 sai method, 429 vượt giới hạn, 500 lỗi xử lý, 502 lỗi kết nối upstream, 503 tạm thời chưa có dữ liệu, 504 quá thời gian chờ. Client kiểm tra status và `error.code`; không phụ thuộc chuỗi `message`. Proxy giữ `Retry-After` khi backend yêu cầu chờ rồi thử lại.

## Cache và dung lượng

| Nhóm dữ liệu | Chính sách tại proxy |
| --- | --- |
| Giá trực tiếp, orderbook, chỉ số hiện tại, overview có giá mới, lịch sử giá cập nhật, macro rates | `no-store` |
| Lỗi, health, file export và manifest chứa URL tải | `no-store` |
| `/market/heatmap` | Snapshot tại CDN 5 giây, `stale-while-revalidate=10`; browser `max-age=0` |
| Tin tức, sự kiện, quỹ | 30 giây; cho phép phục vụ bản cũ trong lúc cập nhật theo header |
| Báo cáo và chuỗi tài chính, summary với `realtime=0` | 120 giây |
| Hồ sơ doanh nghiệp và danh mục ít thay đổi | 600 giây |

Alias cũ và URL chuẩn dùng cùng chính sách. `cache=no-store` hoặc `nocache=1` yêu cầu bỏ cache của proxy. Giới hạn từ upstream như `no-store`, `private`, `no-cache` và thời hạn ngắn hơn được giữ; proxy không nâng chúng thành cache công khai dài hơn. TTL này là lớp proxy, tách với thời gian cập nhật nguồn và cache bên trong backend.

Heatmap dùng cache ngắn để giảm lần đi qua function tới backend khi nhiều người mở trang. Chỉ response thành công được chia sẻ; lỗi và yêu cầu bỏ cache vẫn `no-store`. Các endpoint giá trực tiếp giữ nguyên chính sách, và fetch từ Next.js tới backend không tạo cache lưu lâu dài.

Ưu tiên endpoint nhỏ đúng nhu cầu và `compact=1` khi chỉ hiển thị danh sách tin; không tải overview đầy đủ để chỉ lấy giá. `/market/overview?compact=1` chỉ trả `indexValuationChart`, bỏ bản sao `peChart` và rút gọn tin. Proxy chuyển tiếp body dạng stream, giữ status và header tải file; không giải mã rồi mã hóa lại toàn bộ JSON thành công. Proxy chỉ cache tại CDN, không tạo thêm một lớp cache fetch lâu dài trong Next.js.

## Triển khai

Proxy và các fetch trực tiếp từ server chuyển URL chuẩn sang đường dẫn upstream tương thích dựa trên manifest chung. Vì vậy frontend mới hoạt động với cả backend cũ lẫn mới, không cần retry 404 và không phụ thuộc thứ tự triển khai. Backend mới cũng phục vụ trực tiếp các alias chuẩn. Bộ triển khai backend cần chứa manifest tại `frontend-next/src/lib/apiRouteAliases.json`, không cần cài hay build Node để đọc file này.

Không xóa alias trong cùng đợt chuyển đổi. Trước khi bỏ một URL cũ, cần kiểm tra các client còn dùng nó và công bố thay đổi hợp đồng. Các tối ưu Python có hiệu lực khi tiến trình backend nạp phiên bản mới.
