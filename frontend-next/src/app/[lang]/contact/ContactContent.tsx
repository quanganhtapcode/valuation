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
            <div className={styles.lastUpdated}>{copy.eyebrow}</div>
            <div className={styles.content}>
                <section className={styles.section}>
                    <h2>{copy.profileTitle}</h2>
                    <p>{copy.bio}</p>
                    <p>{copy.education}</p>
                    <p>{copy.focus}</p>
                    <div className={styles.profileLinks}>
                        <a href="https://www.quanganh.org/" className={styles.link} target="_blank" rel="noreferrer">{copy.profileLink}</a>
                        <a href="https://orcid.org/0009-0007-7751-9352" className={styles.link} target="_blank" rel="noreferrer">ORCID</a>
                    </div>
                </section>
                <section className={styles.section}>
                    <h2>{copy.highlightsTitle}</h2>
                    <ul className={styles.highlights}>
                        <li>{copy.highlightResearch}</li>
                        <li>{copy.highlightPlatform}</li>
                        <li>{copy.highlightRecognition}</li>
                    </ul>
                </section>
                <section className={styles.section}>
                    <h2>{copy.direct}</h2>
                    <div className={styles.contactInfo}>
                        <div className={styles.contactItem}><span className={styles.label}>{copy.developer}</span><span className={styles.value}>Anh Quang Le</span></div>
                        <div className={styles.contactItem}><span className={styles.label}>Email:</span>{' '}<a href="mailto:quanganh.ibd@gmail.com" className={styles.link}>quanganh.ibd@gmail.com</a></div>
                        <div className={styles.contactItem}><span className={styles.label}>{copy.phone}</span>{' '}<a href="tel:+84813601054" className={styles.link}>+84 813 601 054</a></div>
                    </div>
                </section>
                <section className={styles.section}>
                    <h2>{copy.support}</h2><p>{copy.supportText}</p><p className={styles.highlight}>{copy.collaborate}</p>
                </section>
            </div>
        </main>
    );
}
