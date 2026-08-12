'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';
import styles from './page.module.css';

export default function AboutContent() {
    const { lang } = useLanguage();
    const copy = translations[lang].staticPages.about;

    return (
        <main className={styles.container}>
            <header className={styles.hero}>
                <span className={styles.badge}>{copy.badge}</span>
                <h1 className={styles.title}>{copy.title} <span className={styles.gradient}>{copy.titleAccent}</span></h1>
                <p className={styles.lead}>{copy.lead}</p>
            </header>
            <section className={styles.section}>
                <div className={styles.grid}>
                    <div className={styles.card}><h3>{copy.precisionTitle}</h3><p>{copy.precisionText}</p></div>
                    <div className={styles.card}><h3>{copy.valuationTitle}</h3><p>{copy.valuationText}</p></div>
                </div>
            </section>
            <section className={styles.section}>
                <div className={styles.pillars}>
                    <div className={styles.pillar}><div className={styles.iconWrapper}>🔭</div><h4>{copy.clarity}</h4><p>{copy.clarityText}</p></div>
                    <div className={styles.pillar}><div className={styles.iconWrapper}>⚡</div><h4>{copy.speed}</h4><p>{copy.speedText}</p></div>
                    <div className={styles.pillar}><div className={styles.iconWrapper}>🛡️</div><h4>{copy.integrity}</h4><p>{copy.integrityText}</p></div>
                </div>
            </section>
            <section className={styles.cta}>
                <h2>{copy.cta}</h2><p>{copy.ctaText}</p>
                <Link href="/overview" className={styles.ctaButton}>{copy.explore}</Link>
            </section>
        </main>
    );
}
