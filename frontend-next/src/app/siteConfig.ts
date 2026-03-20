export const siteConfig = {
    name: "Quang Anh",
    url: "https://stock.quanganh.org",
    description: "Vietnam stock analysis platform: DCF valuation, P/E, P/B ratios, market heatmap, news and real-time financial data.",
    baseLinks: {
        home: "/",
        overview: "/overview",
about: "/about",
        changelog: "/changelog",
        pricing: "/pricing",
        imprint: "/imprint",
        privacy: "/privacy",
        terms: "/terms",
    },
    stockLogoUrl: (symbol: string) => `https://vietcap-documents.s3.ap-southeast-1.amazonaws.com/sentiment/logo/${symbol.toUpperCase()}.jpeg`,
}

export type siteConfig = typeof siteConfig
