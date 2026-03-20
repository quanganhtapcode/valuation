import styles from './page.module.css';

export const metadata = {
    title: 'Terms of Service',
    description: 'Terms of Service for the Quang Anh stock analysis platform.',
    alternates: { canonical: 'https://stock.quanganh.org/terms' },
};

export default function TermsPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Terms of Service</h1>

            <div className={styles.lastUpdated}>Last updated: January 25, 2026</div>

            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>1. Acceptance of Terms</h2>
                    <p>
                        By accessing and using the Quang Anh platform (the &quot;Service&quot;), you agree to be bound by these Terms of Service, all applicable laws, and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>2. Description of Service</h2>
                    <p>
                        Quang Anh provides stock analysis tools, valuation models, and financial market information for the Vietnam stock market. Data is aggregated from various reputable sources including CafeF, Vietstock, and securities firms.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>3. Financial Advice Disclaimer</h2>
                    <p className={styles.highlight}>
                        The content on Quang Anh is for informational and educational purposes only. It does NOT constitute professional investment advice. All investment decisions made based on information from this website are the sole responsibility of the user. We strongly recommend consulting with a certified financial advisor before making any significant investment decisions.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>4. Intellectual Property & Usage</h2>
                    <p>
                        All content, images, source code, and data tables on this website are the intellectual property of Quang Anh. You are permitted to use the Service for personal, non-commercial purposes only. Any unauthorized copying, distribution, bulk data scraping, or commercial use without prior written consent is strictly prohibited.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>5. Accuracy of Information</h2>
                    <p>
                        While we strive to provide the most accurate and up-to-date data, we do not warrant that all information is complete or error-free. Market data may be delayed by at least 15-20 minutes depending on the source provider.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>6. Limitation of Liability</h2>
                    <p>
                        In no event shall Quang Anh or its developers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on the website.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>7. External Links</h2>
                    <p>
                        Quang Anh has not reviewed all of the sites linked to its website and is not responsible for the contents of any such linked site. The inclusion of any link does not imply endorsement by Quang Anh of the site. Use of any such linked website is at the user&apos;s own risk.
                    </p>
                </section>
            </div>
        </main>
    );
}
