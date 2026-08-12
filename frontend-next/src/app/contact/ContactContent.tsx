'use client';

import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';
import styles from './page.module.css';

export default function ContactContent() {
    const { lang } = useLanguage();
    const copy = translations[lang].staticPages.contact;

    return (
        <main className={styles.container}>
            <h1 className={styles.title}>{copy.title}</h1>
            <div className={styles.lastUpdated}>{copy.response}</div>
            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>{copy.direct}</h2>
                    <div className={styles.contactInfo}>
                        <div className={styles.contactItem}><span className={styles.label}>{copy.developer}</span><span className={styles.value}>Le Quang Anh</span></div>
                        <div className={styles.contactItem}><span className={styles.label}>Email:</span><a href="mailto:contact@quanganh.org" className={styles.link}>contact@quanganh.org</a></div>
                        <div className={styles.contactItem}><span className={styles.label}>{copy.phone}</span><a href="tel:+84813601054" className={styles.link}>+84 813 601 054</a></div>
                    </div>
                </section>
                <section className={styles.section}>
                    <h2>{copy.support}</h2><p>{copy.supportText}</p><p className={styles.highlight}>{copy.collaborate}</p>
                </section>
            </div>
        </main>
    );
}
