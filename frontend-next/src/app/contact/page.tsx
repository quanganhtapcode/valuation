import styles from './page.module.css';

export const metadata = {
    title: 'Contact',
    description: 'Get in touch with the Quang Anh team.',
    alternates: { canonical: '/contact' },
};

export default function ContactPage() {
    return (
        <main className={styles.container}>
            <h1 className={styles.title}>Contact Us</h1>

            <div className={styles.lastUpdated}>We typically respond within 24-48 hours.</div>

            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>Direct Contact</h2>
                    <div className={styles.contactInfo}>
                        <div className={styles.contactItem}>
                            <span className={styles.label}>Lead Developer:</span>
                            <span className={styles.value}>Le Quang Anh</span>
                        </div>
                        <div className={styles.contactItem}>
                            <span className={styles.label}>Email:</span>
                            <a href="mailto:contact@quanganh.org" className={styles.link}>contact@quanganh.org</a>
                        </div>
                        <div className={styles.contactItem}>
                            <span className={styles.label}>Phone:</span>
                            <a href="tel:+84813601054" className={styles.link}>+84 813 601 054</a>
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <h2>Feedback & Support</h2>
                    <p>
                        Whether you have a technical question, a feature suggestion, or just want to say hi,
                        I&apos;m always open to hearing from you. Please reach out via email or phone above.
                    </p>
                    <p className={styles.highlight}>
                        Interested in collaborating or have a business inquiry? Let&apos;s connect!
                    </p>
                </section>
            </div>
        </main>
    );
}
