'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/languageContext';
import { legalContent, type LegalDocumentId } from '@/lib/legalContent';
import styles from './LegalDocument.module.css';

export default function LegalDocument({ document }: { document: LegalDocumentId }) {
    const { lang } = useLanguage();
    const copy = legalContent[lang][document];

    return (
        <main className={styles.shell}>
            <header className={styles.hero}>
                <div className={styles.heroCopy}>
                    <p className={styles.eyebrow}>{copy.eyebrow}</p>
                    <h1>{copy.title} <span>{copy.accent}</span></h1>
                    <p className={styles.intro}>{copy.intro}</p>
                    <div className={styles.meta}><span>{copy.updated}</span><span aria-hidden="true">•</span><span>{copy.readingTime}</span></div>
                </div>
                <div className={styles.summary}>
                    <span>{copy.summaryLabel}</span>
                    <p>{copy.summary}</p>
                </div>
                <nav className={styles.documentNav} aria-label={copy.eyebrow}>
                    {(Object.keys(copy.nav) as LegalDocumentId[]).map((id) => (
                        <Link key={id} href={`/${lang}/${id}`} aria-current={id === document ? 'page' : undefined} className={id === document ? styles.active : undefined}>
                            {copy.nav[id]}
                        </Link>
                    ))}
                </nav>
            </header>

            <div className={styles.layout}>
                <aside className={styles.sidebar}>
                    <p>{copy.toc}</p>
                    <ol>
                        {copy.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title.replace(/^\d+\.\s*/, '')}</a></li>)}
                    </ol>
                </aside>
                <article className={styles.article}>
                    {copy.sections.map((section) => (
                        <section id={section.id} key={section.id} className={styles.section}>
                            <h2>{section.title}</h2>
                            {section.important && <p className={styles.important}>{section.important}</p>}
                            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                            {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
                        </section>
                    ))}
                </article>
            </div>
        </main>
    );
}
