import Link from 'next/link';
import styles from './page.module.css';

export const metadata = {
    title: 'About',
    description: 'Quang Anh is a Vietnam stock analysis platform with DCF valuation tools, P/E, P/B ratios and real-time financial data.',
    alternates: { canonical: 'https://stock.quanganh.org/about' },
};

export default function AboutPage() {
    return (
        <main className={styles.container}>
            <header className={styles.hero}>
                <span className={styles.badge}>Our Vision</span>
                <h1 className={styles.title}>
                    Democratizing <span className={styles.gradient}>Financial Intelligence</span>
                </h1>
                <p className={styles.lead}>
                    Quang Anh is a cutting-edge stock analysis platform built to bridge the gap between complex market data and actionable investment decisions in Vietnam.
                </p>
            </header>

            <section className={styles.section}>
                <div className={styles.grid}>
                    <div className={styles.card}>
                        <h3>Precision Data</h3>
                        <p>
                            We aggregate real-time data from HNX, HOSE, and UPCOM, ensuring our users have access to the most accurate pricing, volume, and fundamental metrics available. Our data pipeline is built for speed and reliability.
                        </p>
                    </div>
                    <div className={styles.card}>
                        <h3>Advanced Valuation</h3>
                        <p>
                            Beyond just reporting numbers, we provide institutional-grade valuation tools. From DCF and FCFE to Graham&apos;s formula, we empower retail investors with the same methodologies used by professionals.
                        </p>
                    </div>
                </div>
            </section>

            <section className={styles.section}>
                <div className={styles.pillars}>
                    <div className={styles.pillar}>
                        <div className={styles.iconWrapper}>🔭</div>
                        <h4>Clarity</h4>
                        <p>Visualizing market trends through intuitive charts and clean interfaces.</p>
                    </div>
                    <div className={styles.pillar}>
                        <div className={styles.iconWrapper}>⚡</div>
                        <h4>Speed</h4>
                        <p>Real-time updates and lightning-fast analysis in the palm of your hand.</p>
                    </div>
                    <div className={styles.pillar}>
                        <div className={styles.iconWrapper}>🛡️</div>
                        <h4>Integrity</h4>
                        <p>Transparent methodologies and objective metrics you can trust.</p>
                    </div>
                </div>
            </section>

            <section className={styles.cta}>
                <h2>Ready to elevate your research?</h2>
                <p>Join thousands of investors using Quang Anh to navigate the market with confidence.</p>
                <Link href="/overview" className={styles.ctaButton}>
                    Explore Market Intelligence
                </Link>
            </section>
        </main>
    );
}
