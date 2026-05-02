import styles from './company.module.css';

export const metadata = {
    title: 'Danh Sách Doanh Nghiệp Niêm Yết Việt Nam | HOSE, HNX, UPCOM',
    description:
        'Tra cứu và phân tích doanh nghiệp niêm yết trên sàn chứng khoán Việt Nam: HOSE, HNX, UPCOM. Thông tin ngành, vốn hóa, chỉ số tài chính và lịch sử giá.',
    keywords: [
        'danh sách doanh nghiệp niêm yết Việt Nam',
        'cổ phiếu HOSE',
        'cổ phiếu HNX',
        'cổ phiếu UPCOM',
        'vietnam listed companies',
        'hose company list',
        'hnx company list',
        'upcom company list',
        'vietnam company directory',
    ],
    alternates: { canonical: '/company' },
    openGraph: {
        title: 'Danh Sách Doanh Nghiệp Niêm Yết Việt Nam | Quang Anh',
        description:
            'Tra cứu doanh nghiệp niêm yết trên HOSE, HNX, UPCOM với thông tin ngành, vốn hóa và chỉ số tài chính.',
        url: '/company',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Danh Sách Doanh Nghiệp Niêm Yết Việt Nam | Quang Anh',
        description:
            'Tra cứu và phân tích 1.700+ doanh nghiệp niêm yết trên HOSE, HNX, UPCOM.',
    },
};

export default function CompanyPage() {
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>🏢 Company Directory</h1>
            <p className={styles.subtitle}>
                Detailed insights and analysis for companies listed on HOSE, HNX, and UPCOM
            </p>

            <div className={styles.searchSection}>
                <div className={styles.searchBox}>
                    <input
                        type="text"
                        placeholder="Enter stock symbol or company name..."
                        className={styles.searchInput}
                    />
                    <button className={styles.searchButton}>Search</button>
                </div>
            </div>

            <div className={styles.comingSoon}>
                <div className={styles.icon}>🚧</div>
                <h2>Under Development</h2>
                <p>We are currently building an advanced company directory with powerful features:</p>
                <ul className={styles.featureList}>
                    <li>📊 Peer comparison by industry</li>
                    <li>📈 Historical financial charts</li>
                    <li>🔍 Advanced screening by sector, exchange, and market cap</li>
                    <li>⭐ Personal watchlist integration</li>
                </ul>
                <p className={styles.hint}>
                    In the meantime, you can use the search bar in the header to look up specific stock symbols directly.
                </p>
            </div>
        </div>
    );
}
