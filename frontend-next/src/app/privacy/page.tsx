import styles from './page.module.css';

export const metadata = {
    title: 'Privacy Policy',
    description: 'Privacy policy for the Quang Anh stock analysis platform.',
    alternates: { canonical: 'https://stock.quanganh.org/privacy' },
};

export default function PrivacyPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Privacy Policy</h1>

            <div className={styles.lastUpdated}>Last updated: January 25, 2026</div>

            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>1. Information Collection</h2>
                    <p>
                        Quang Anh respects your privacy. Currently, our application does not require user accounts and does not collect personally identifiable information (PII) such as names, addresses, phone numbers, or emails through general usage.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>2. Technical Data & Cookies</h2>
                    <p>
                        Like most websites, we may collect non-personally identifying information of the sort that web browsers and servers typically make available, such as browser type, language preference, referring site, and the date and time of each visitor request. We also use &quot;Cookies&quot; to store your personal preferences (e.g., Dark/Light mode) to enhance your user experience.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>3. Third-Party Services</h2>
                    <p>
                        We may use third-party analytics services (such as Google Analytics) to track and report website traffic. These services collect data on how users interact with the website to help us optimize the interface and features.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>4. Data Security</h2>
                    <p>
                        We implement standard security measures (SSL/HTTPS) to protect data transmitted between your browser and our servers. However, please be aware that no method of transmission over the Internet is 100% secure.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>5. External Links</h2>
                    <p>
                        Our Service contains links to other websites (e.g., CafeF, Vietstock). If you click on a third-party link, you will be directed to that site. We strongly advise you to review the Privacy Policy of every site you visit.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>6. Policy Updates</h2>
                    <p>
                        We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
                    </p>
                </section>

                <section className={styles.section}>
                    <h2>7. Contact</h2>
                    <p>
                        If you have any questions about this Privacy Policy, please contact us at:
                        <a href="mailto:contact@quanganh.org" className={styles.link}> contact@quanganh.org</a>
                    </p>
                </section>
            </div>
        </main>
    );
}
