import styles from './page.module.css';

export const metadata = {
    title: 'Disclaimer',
    description: 'Legal disclaimer regarding information and data on the Quang Anh platform.',
    alternates: { canonical: 'https://stock.quanganh.org/disclaimer' },
};

export default function DisclaimerPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Disclaimer</h1>

            <div className={styles.lastUpdated}>Effective Date: January 25, 2026</div>

            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>1. Not Financial Advice</h2>
                    <p className={styles.highlight}>
                        All information, data, analysis, and charts provided on Quang Anh are for informational and research purposes only. WE DO NOT provide any investment advice or recommendations to buy/sell stocks, derivatives, or any form of financial investment.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>2. Market Risk</h2>
                    <p>
                        Investing in the stock market involves significant risk. The value of investments can go up or down, and you may lose some or all of your invested capital. Past performance is not a reliable indicator of future results. You are solely responsible for your own financial decisions.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>3. Data Accuracy</h2>
                    <p>
                        Data on this website is aggregated from reliable sources within the Vietnamese stock market. However, we cannot guarantee 100% accuracy, completeness, or timeliness of the information. Data may be subject to technical errors from source providers or during transmission.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>4. Personal Responsibility</h2>
                    <p>
                        By using this website, you agree that Quang Anh and its development team shall not be held liable for any loss, damage, or expense (whether direct or indirect) arising from your use of information or tools on this website for financial transactions.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>5. Professional Consultation</h2>
                    <p>
                        We strongly recommend that users discuss with professional financial advisors or certified brokers and perform their own independent Due Diligence before making any transactions in the stock market.
                    </p>
                </section>
            </div>
        </main>
    );
}
