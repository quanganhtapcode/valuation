/** UI copy grouped by feature. Both locales must have the same keys. */
type MessageShape<T> = T extends string ? string : { [K in keyof T]: MessageShape<T[K]> };

const vi = {
    "app_lang_about_AboutContent": {
        "platformCreator": "Người xây dựng nền tảng",
        "quangAnhBuildsProductsAndAnalysis": "Quang Anh xây dựng các sản phẩm và công cụ phân tích giúp nhà đầu tư tiếp cận dữ liệu chứng khoán Việt Nam rõ ràng, thuận tiện hơn.",
        "quangAnhProfile": "Hồ sơ Quang Anh"
    },
    "app_lang_downloads_page": {
        "downloadCategory": "Loại dữ liệu tải xuống",
        "financialReportsMetrics": "Báo cáo tài chính & chỉ số",
        "marketData": "Dữ liệu thị trường",
        "stockMetricSourceVietcapWithSSI": "Nguồn chỉ số cổ phiếu: Vietcap; lịch sử bổ sung từ SSI cho các kỳ hoặc ô còn thiếu sau khi đối chiếu cùng mã và kỳ báo cáo. Ưu tiên Vietcap khi có. PE/PB lịch sử xuất riêng thành pe_ssi, pe_vietcap, pb_ssi, pb_vietcap; cách xác định giá giữa hai nguồn có thể khác nhau. Độ phủ tùy mã và chỉ số; dữ liệu sớm nhất hiện có là 2006, chưa bảo đảm đầy đủ từ IPO.",
        "loadingFieldCatalog": "Đang tải danh mục biến…",
        "theFieldCatalogIsUnavailable": "Chưa có danh mục biến.",
        "stockMetrics": [
            "Chỉ số cổ phiếu",
            "Định giá, sinh lời, thanh khoản và chỉ số ngân hàng"
        ],
        "stockMetricsHistory": [
            "Lịch sử chỉ số cổ phiếu",
            "Chuỗi PE, PB, ROE, ROA và các chỉ số theo năm hoặc quý"
        ]
    },
    "app_lang_funds_FundsClient": {
        "sortFunds": "Sắp xếp quỹ",
        "text1y": "1 năm",
        "text3yAnn": "3 năm/năm",
        "showMoreFunds": "Xem thêm quỹ"
    },
    "app_lang_macro_page": {
        "viewChartAndDownloadData": "xem biểu đồ và tải dữ liệu",
        "selectAnIndicatorToViewIts": "Chọn một chỉ số để xem biểu đồ và dữ liệu."
    },
    "app_lang_screener_page": {
        "enGB": "vi-VN",
        "sortBy": "Sắp xếp theo",
        "sortOrder": "Thứ tự sắp xếp",
        "select25StocksForA": "Chọn 2–5 mã để đối chiếu riêng.",
        "compare": "So sánh",
        "selected": "Đã chọn",
        "marketCap": "Vốn hóa",
        "revenueYoY": "DT YoY",
        "profitYoY": "LN YoY",
        "dataSourcesTimestampsMetricGuide": "Nguồn dữ liệu, thời gian & cách đọc chỉ tiêu",
        "sourceLocallyStoredVietcapVCIData": "Nguồn: dữ liệu Vietcap/VCI lưu tại hệ thống; tỷ số và biên lợi nhuận có thể được bổ sung từ bộ dữ liệu tỷ số và tài chính. Giá trị nội tại lấy từ bộ nhớ định giá của hệ thống.",
        "priceVNDShareGrowthAndMargins": "Giá: VND/cổ phiếu. Tăng trưởng và biên lợi nhuận: %. P/E, P/B: lần. T = nghìn tỷ, B = tỷ, M = triệu VND. YoY = so với cùng kỳ năm trước. Dấu — hoặc - là thiếu dữ liệu, khác với 0.",
        "theAPIDoesNotExposeReporting": "API chưa cung cấp kỳ báo cáo và thời điểm cập nhật gốc cho từng chỉ tiêu. Thời gian nhận kết quả không phải thời gian giao dịch; kết quả có thể được lưu đệm 120 giây.",
        "guidePEPriceEarningsPer": "Cách đọc: P/E = giá / lợi nhuận mỗi cổ phiếu; P/B = giá / giá trị sổ sách mỗi cổ phiếu; ROE = lợi nhuận / vốn chủ sở hữu; biên lợi nhuận = lợi nhuận / doanh thu; tăng trưởng YoY = (kỳ này / cùng kỳ − 1) × 100%. Cách chọn kỳ và mẫu số cụ thể theo nguồn dữ liệu.",
        "screenResponseReceivedAt": "Nhận kết quả bộ lọc lúc",
        "refreshing": " · Đang cập nhật",
        "refreshFailedPreviousDataMayRemain": " · Cập nhật thất bại; dữ liệu trước đó có thể còn hiển thị",
        "sortLabels": {
            "market_cap": "Vốn hóa",
            "upside_pct": "Tiềm năng tăng",
            "pe": "P/E",
            "pb": "P/B",
            "roe": "ROE",
            "price": "Giá",
            "daily_change": "Thay đổi giá",
            "revenue_growth": "Tăng trưởng DT",
            "net_profit_growth": "Tăng trưởng LN"
        }
    },
    "components_Downloads_MarketDownloads": {
        "downloadUnavailablePleaseTryAgain": "Chưa tải được dữ liệu. Vui lòng thử lại.",
        "downloadFailed": "Không tải được dữ liệu.",
        "marketData": "Dữ liệu thị trường",
        "downloadPricesValuationsCompaniesFundsAnd": "Tải lịch sử giá, định giá, danh mục doanh nghiệp, dữ liệu quỹ và nhiều bộ dữ liệu khác dưới dạng CSV hoặc Excel.",
        "couldNotLoadTheCatalog": "Chưa tải được danh mục.",
        "retry": "Thử lại",
        "loadingDatasets": "Đang tải danh mục…",
        "dataset": "Bộ dữ liệu",
        "unavailable": " — chưa có dữ liệu",
        "format": "Định dạng",
        "from": "Từ ngày",
        "to": "Đến ngày",
        "symbolsSeparatedByCommas": "Mã, cách nhau bằng dấu phẩy",
        "blankForAll": " (để trống để lấy tất cả)",
        "source": "Nguồn: ",
        "leaveDatesBlankForAllAvailable": "Để trống ngày để lấy toàn bộ lịch sử hiện có.",
        "latestSnapshotNotAHistoricalSeries": "Bản dữ liệu mới nhất, không phải chuỗi lịch sử.",
        "exportedColumns": "Các cột trong tệp",
        "preparing": "Đang tạo tệp…",
        "downloadMarketData": "↓ Tải dữ liệu thị trường",
        "upTo100000RowsPer": "Tối đa 100.000 dòng/tệp. Không cắt bớt dữ liệu khi vượt giới hạn.",
        "downloadedRows": "Đã tải {count} dòng dữ liệu.",
        "downloadedDataset": "Đã tải tệp dữ liệu."
    },
    "components_EarningsSeason_EarningsSeason": {
        "newsSignals24h": "Tín hiệu tin tức · 24h",
        "lastAvailable": "Dữ liệu gần nhất",
        "updated": "Cập nhật",
        "readTheOriginalArticleForDetails": "Xem bài gốc để đọc chi tiết.",
        "readOriginalArticle": "Đọc bài gốc",
        "sources": "Nguồn",
        "newsUpdate": "Tin nổi bật {index}"
    },
    "components_Funds_FundsComparison": {
        "fundComparisonChart": "Biểu đồ so sánh quỹ",
        "all": "Tất cả",
        "loadingNAVHistory": "Đang tải lịch sử NAV…",
        "from": "Từ",
        "to": "Đến",
        "reset": "Đặt lại",
        "enUS": "vi-VN",
        "year": "/ năm",
        "remove": "Bỏ chọn",
        "navChangeRebasedTo0At": "Thay đổi NAV (%), cùng mốc bắt đầu = 0%. Giữa các kỳ công bố dùng NAV gần nhất; khoảng so sánh là phần lịch sử chung. CAGR được quy đổi theo năm từ NAV trong khoảng ngày đang xem.",
        "notEnoughSharedHistoryForThis": "Không đủ lịch sử chung cho khoảng thời gian này.",
        "selectFundsToCompare": "Chọn quỹ phía dưới để so sánh.",
        "insufficientNAVHistory": "Chưa có đủ lịch sử NAV:",
        "unableToLoad": "Không tải được dữ liệu:",
        "fundListing": "danh sách quỹ",
        "retry": "Thử lại",
        "selectFunds": "Chọn quỹ so sánh",
        "searchComparisonFunds": "Tìm quỹ so sánh",
        "searchFunds": "Tìm mã hoặc tên quỹ…",
        "fundType": "Loại quỹ",
        "allFundTypes": "Tất cả loại quỹ",
        "fundManager": "Công ty quản lý",
        "allManagers": "Tất cả công ty",
        "noMatchingFunds": "Không có quỹ phù hợp."
    },
    "components_HeroIndexCard_HeroIndexCard": {
        "referencePrice": "Giá tham chiếu",
        "indexHistory": "Lịch sử chỉ số",
        "loadingHistory": "Đang tải lịch sử…",
        "earlierHistoryIsUnavailable": "Chưa tải được đoạn lịch sử trước.",
        "chartDataIsUnavailable": "Chưa tải được dữ liệu biểu đồ.",
        "retry": "Thử lại"
    },
    "components_Macro_MacroHistoryModal": {
        "unit": "Đơn vị",
        "indicator": "Chỉ tiêu",
        "oneYear": "1 năm"
    },
    "components_Macro_macroData": {
        "enGB": "vi-VN"
    },
    "components_Screener_SavedScreens": {
        "unableToReadSavedScreens": "Không đọc được bộ lọc đã lưu.",
        "browserStorageIsUnavailable": "Trình duyệt không cho phép lưu.",
        "saveShareScreens": "Lưu & chia sẻ bộ lọc",
        "screenName": "Tên bộ lọc",
        "screenName2": "Tên bộ lọc…",
        "savedInThisBrowser": "Đã lưu trên trình duyệt này.",
        "saveScreen": "Lưu bộ lọc",
        "linkCopied": "Đã sao chép liên kết.",
        "copyTheLinkBelow": "Sao chép liên kết trong ô bên dưới.",
        "shareScreenComparison": "Chia sẻ bộ lọc & so sánh",
        "presetRevenueProfitGrowth20": "Mẫu: tăng trưởng doanh thu & lợi nhuận ≥20%",
        "upTo20ScreensInThis": "Tối đa 20 bộ lọc trên trình duyệt này; lưu cùng tên sẽ thay thế. Mẫu tăng trưởng dùng chỉ tiêu YoY của nguồn dữ liệu.",
        "shareLink": "Liên kết chia sẻ",
        "delete": "Xóa"
    },
    "components_Screener_StockComparison": {
        "unableToLoadComparison": "Không tải được dữ liệu so sánh.",
        "metric": "Chỉ tiêu",
        "enUS": "vi-VN",
        "stockComparison": "So sánh cổ phiếu",
        "selected": "Đã chọn",
        "closeComparison": "Đóng so sánh",
        "compareSelected": "So sánh đã chọn",
        "remove": "Bỏ",
        "selectOneMoreStockToCompare": "Chọn thêm một mã để so sánh.",
        "blueHighestAmberLowestInYour": "Xanh: cao nhất · Vàng: thấp nhất trong nhóm đã chọn. Màu không biểu thị tốt/xấu.",
        "retry": "Thử lại",
        "loading": "Đang tải…",
        "unavailable": "Không có dữ liệu: ",
        "stockNumber": "Cổ phiếu {index}",
        "metricLabels": {
            "marketPrice": "Giá",
            "marketCap": "Vốn hóa (tỷ VND)",
            "ttmPe": "P/E",
            "ttmPb": "P/B",
            "ttmRoe": "ROE",
            "netMargin": "Biên lợi nhuận ròng",
            "grossMargin": "Biên lợi nhuận gộp",
            "revenueGrowthYoy": "Tăng trưởng doanh thu YoY",
            "npatmiGrowthYoyQm1": "Tăng trưởng lợi nhuận YoY"
        }
    },
    "components_Sidebar_CryptoPrices": {
        "exchange": "Sàn",
        "buy": "Mua",
        "sell": "Bán",
        "comparedWithPreviousUpdate": "So với lần cập nhật trước",
        "cashRateDated": "Tiền mặt, tỷ giá ngày",
        "cashRate": "Tỷ giá tiền mặt",
        "cashUSD": "USD tự do"
    },
    "components_StockDetail_BankingPeerTable": {
        "quarter": "Quý",
        "year": "Năm",
        "comparisonPeriod": "Kỳ so sánh"
    },
    "components_StockDetail_FinancialsTab": {
        "unitVNDBn": "Đơn vị: tỷ VND",
        "unitVNDTn": "Đơn vị: nghìn tỷ VND"
    },
    "components_StockDetail_HoldersTab": {
        "institutional": "Cổ đông tổ chức",
        "regularShareholders": "Cổ đông cá nhân",
        "loadingHolders": "Đang tải cổ đông...",
        "unableToLoadHoldersData": "Không thể tải dữ liệu cổ đông",
        "holders": "Cổ đông",
        "shareholderType": "Loại cổ đông",
        "downloadAllShareholders": "Tải danh sách cổ đông",
        "manager": "Cổ đông",
        "sharesOwned": "Số cổ phiếu",
        "currentValue": "Giá trị hiện tại",
        "ownership": "Sở hữu (%)",
        "updatedAt": "Ngày cập nhật",
        "noDataForThisSection": "Chưa có dữ liệu."
    },
    "components_StockDetail_TechnicalTab": {
        "neutral": "Trung lập",
        "level": "Mức giá",
        "rResistanceSSupportPivotPivot": "R: Kháng cự · S: Hỗ trợ · Pivot: Điểm xoay",
        "strongBuy": "Mua mạnh",
        "buy": "Mua",
        "strongSell": "Bán mạnh",
        "sell": "Bán"
    },
    "components_StockPageShell": {
        "opening": "Đang mở {symbol}"
    }
} as const;

const en = {
    "app_lang_about_AboutContent": {
        "platformCreator": "Platform creator",
        "quangAnhBuildsProductsAndAnalysis": "Quang Anh builds products and analysis tools that make Vietnamese stock-market data clearer and more accessible to investors.",
        "quangAnhProfile": "Quang Anh profile"
    },
    "app_lang_downloads_page": {
        "downloadCategory": "Download category",
        "financialReportsMetrics": "Financial reports & metrics",
        "marketData": "Market data",
        "stockMetricSourceVietcapWithSSI": "Stock metric source: Vietcap, with SSI backfilling missing historical periods or values after matching the same ticker and reporting period. Vietcap takes priority. Historical PE/PB are exported separately as pe_ssi, pe_vietcap, pb_ssi, pb_vietcap; source valuation price conventions may differ. Coverage varies by ticker and metric; available history starts in 2006 and may not cover every ticker from IPO.",
        "loadingFieldCatalog": "Loading field catalog…",
        "theFieldCatalogIsUnavailable": "The field catalog is unavailable.",
        "stockMetrics": [
            "Stock metrics",
            "Valuation, profitability, liquidity, and banking metrics"
        ],
        "stockMetricsHistory": [
            "Stock metric history",
            "PE, PB, ROE, ROA, and other annual or quarterly metric history"
        ]
    },
    "app_lang_funds_FundsClient": {
        "sortFunds": "Sort funds",
        "text1y": "1Y",
        "text3yAnn": "3Y ann.",
        "showMoreFunds": "Show more funds"
    },
    "app_lang_macro_page": {
        "viewChartAndDownloadData": "view chart and download data",
        "selectAnIndicatorToViewIts": "Select an indicator to view its chart and data."
    },
    "app_lang_screener_page": {
        "enGB": "en-GB",
        "sortBy": "Sort by",
        "sortOrder": "Sort order",
        "select25StocksForA": "Select 2–5 stocks for a focused comparison.",
        "compare": "Compare",
        "selected": "Selected",
        "marketCap": "Market cap",
        "revenueYoY": "Revenue YoY",
        "profitYoY": "Profit YoY",
        "dataSourcesTimestampsMetricGuide": "Data sources, timestamps & metric guide",
        "sourceLocallyStoredVietcapVCIData": "Source: locally stored Vietcap/VCI data; ratios and margins may be supplemented from ratio and financial datasets. Intrinsic values come from the valuation cache.",
        "priceVNDShareGrowthAndMargins": "Price: VND/share. Growth and margins: %. P/E and P/B: multiples. T = trillion, B = billion, M = million VND. YoY = year over year. — or - indicates missing data, distinct from zero.",
        "theAPIDoesNotExposeReporting": "The API does not expose reporting periods or original update timestamps per metric. Receipt time is not trade time; results may be cached for 120 seconds.",
        "guidePEPriceEarningsPer": "Guide: P/E = price / earnings per share; P/B = price / book value per share; ROE = profit / equity; margin = profit / revenue; YoY growth = (current / prior-year period − 1) × 100%. Exact periods and denominator conventions follow the data source.",
        "screenResponseReceivedAt": "Screen response received at",
        "refreshing": " · Refreshing",
        "refreshFailedPreviousDataMayRemain": " · Refresh failed; previous data may remain visible",
        "sortLabels": {
            "market_cap": "Market Cap",
            "upside_pct": "Upside %",
            "pe": "P/E",
            "pb": "P/B",
            "roe": "ROE",
            "price": "Price",
            "daily_change": "Daily Chg",
            "revenue_growth": "Rev Growth",
            "net_profit_growth": "NP Growth"
        }
    },
    "components_Downloads_MarketDownloads": {
        "downloadUnavailablePleaseTryAgain": "Download unavailable. Please try again.",
        "downloadFailed": "Download failed.",
        "marketData": "Market data",
        "downloadPricesValuationsCompaniesFundsAnd": "Download prices, valuations, companies, funds and other datasets as CSV or Excel.",
        "couldNotLoadTheCatalog": "Could not load the catalog.",
        "retry": "Retry",
        "loadingDatasets": "Loading datasets…",
        "dataset": "Dataset",
        "unavailable": " — unavailable",
        "format": "Format",
        "from": "From",
        "to": "To",
        "symbolsSeparatedByCommas": "Symbols, separated by commas",
        "blankForAll": " (blank for all)",
        "source": "Source: ",
        "leaveDatesBlankForAllAvailable": "Leave dates blank for all available history.",
        "latestSnapshotNotAHistoricalSeries": "Latest snapshot, not a historical series.",
        "exportedColumns": "Exported columns",
        "preparing": "Preparing…",
        "downloadMarketData": "↓ Download market data",
        "upTo100000RowsPer": "Up to 100,000 rows per file. Oversized exports are never truncated.",
        "downloadedRows": "Downloaded {count} rows.",
        "downloadedDataset": "Downloaded the dataset."
    },
    "components_EarningsSeason_EarningsSeason": {
        "newsSignals24h": "News signals · 24h",
        "lastAvailable": "Last available",
        "updated": "Updated",
        "readTheOriginalArticleForDetails": "Read the original article for details.",
        "readOriginalArticle": "Read original article",
        "sources": "Sources",
        "newsUpdate": "News update {index}"
    },
    "components_Funds_FundsComparison": {
        "fundComparisonChart": "Fund comparison chart",
        "all": "All",
        "loadingNAVHistory": "Loading NAV history…",
        "from": "From",
        "to": "To",
        "reset": "Reset",
        "enUS": "en-US",
        "year": "/ year",
        "remove": "Remove",
        "navChangeRebasedTo0At": "NAV change (%), rebased to 0% at a shared start. Latest published NAV is carried between dates; comparison uses the shared history window. CAGR annualizes NAV change over the visible dates.",
        "notEnoughSharedHistoryForThis": "Not enough shared history for this period.",
        "selectFundsToCompare": "Select funds to compare.",
        "insufficientNAVHistory": "Insufficient NAV history:",
        "unableToLoad": "Unable to load:",
        "fundListing": "fund listing",
        "retry": "Retry",
        "selectFunds": "Select funds",
        "searchComparisonFunds": "Search comparison funds",
        "searchFunds": "Search funds…",
        "fundType": "Fund type",
        "allFundTypes": "All fund types",
        "fundManager": "Fund manager",
        "allManagers": "All managers",
        "noMatchingFunds": "No matching funds."
    },
    "components_HeroIndexCard_HeroIndexCard": {
        "referencePrice": "Reference price",
        "indexHistory": "Index history",
        "loadingHistory": "Loading history…",
        "earlierHistoryIsUnavailable": "Earlier history is unavailable.",
        "chartDataIsUnavailable": "Chart data is unavailable.",
        "retry": "Retry"
    },
    "components_Macro_MacroHistoryModal": {
        "unit": "Unit",
        "indicator": "Indicator",
        "oneYear": "1 year"
    },
    "components_Macro_macroData": {
        "enGB": "en-GB"
    },
    "components_Screener_SavedScreens": {
        "unableToReadSavedScreens": "Unable to read saved screens.",
        "browserStorageIsUnavailable": "Browser storage is unavailable.",
        "saveShareScreens": "Save & share screens",
        "screenName": "Screen name",
        "screenName2": "Screen name…",
        "savedInThisBrowser": "Saved in this browser.",
        "saveScreen": "Save screen",
        "linkCopied": "Link copied.",
        "copyTheLinkBelow": "Copy the link below.",
        "shareScreenComparison": "Share screen & comparison",
        "presetRevenueProfitGrowth20": "Preset: revenue & profit growth ≥20%",
        "upTo20ScreensInThis": "Up to 20 screens in this browser; saving the same name replaces it. Growth preset uses source YoY metrics.",
        "shareLink": "Share link",
        "delete": "Delete"
    },
    "components_Screener_StockComparison": {
        "unableToLoadComparison": "Unable to load comparison.",
        "metric": "Metric",
        "enUS": "en-US",
        "stockComparison": "Stock comparison",
        "selected": "Selected",
        "closeComparison": "Close comparison",
        "compareSelected": "Compare selected",
        "remove": "Remove",
        "selectOneMoreStockToCompare": "Select one more stock to compare.",
        "blueHighestAmberLowestInYour": "Blue: highest · Amber: lowest in your selection. Colors are not quality ratings.",
        "retry": "Retry",
        "loading": "Loading…",
        "unavailable": "Unavailable: ",
        "stockNumber": "Stock {index}",
        "metricLabels": {
            "marketPrice": "Price",
            "marketCap": "Market cap (bn VND)",
            "ttmPe": "P/E",
            "ttmPb": "P/B",
            "ttmRoe": "ROE",
            "netMargin": "Net margin",
            "grossMargin": "Gross margin",
            "revenueGrowthYoy": "Revenue growth YoY",
            "npatmiGrowthYoyQm1": "Profit growth YoY"
        }
    },
    "components_Sidebar_CryptoPrices": {
        "exchange": "Exchange",
        "buy": "Buy",
        "sell": "Sell",
        "comparedWithPreviousUpdate": "Compared with previous update",
        "cashRateDated": "Cash rate dated",
        "cashRate": "Cash rate",
        "cashUSD": "Cash USD"
    },
    "components_StockDetail_BankingPeerTable": {
        "quarter": "Quarter",
        "year": "Year",
        "comparisonPeriod": "Comparison period"
    },
    "components_StockDetail_FinancialsTab": {
        "unitVNDBn": "Unit: VND bn",
        "unitVNDTn": "Unit: VND tn"
    },
    "components_StockDetail_HoldersTab": {
        "institutional": "Institutional",
        "regularShareholders": "Regular Shareholders",
        "loadingHolders": "Loading holders...",
        "unableToLoadHoldersData": "Unable to load holders data",
        "holders": "Holders",
        "shareholderType": "Shareholder type",
        "downloadAllShareholders": "Download all shareholders",
        "manager": "Manager",
        "sharesOwned": "Shares Owned",
        "currentValue": "Current Value",
        "ownership": "Ownership (%)",
        "updatedAt": "Updated At",
        "noDataForThisSection": "No data for this section."
    },
    "components_StockDetail_TechnicalTab": {
        "neutral": "Neutral",
        "level": "Level",
        "rResistanceSSupportPivotPivot": "R: Resistance · S: Support · Pivot: Pivot point",
        "strongBuy": "Strong buy",
        "buy": "Buy",
        "strongSell": "Strong sell",
        "sell": "Sell"
    },
    "components_StockPageShell": {
        "opening": "Opening {symbol}"
    }
} satisfies MessageShape<typeof vi>;

export const localizedCopy = { vi, en };
