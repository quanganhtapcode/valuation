'use client';

import { useState, useEffect } from 'react';
import { NewsItem, formatRelativeTime } from '@/lib/api';
import styles from './page.module.css';
import { siteConfig } from '@/app/siteConfig';
import { useLanguage } from '@/lib/languageContext';

export default function NewsPage() {
    const { lang } = useLanguage();
    const copy = lang === 'vi'
        ? { title: 'Tin tức', accent: 'thị trường', subtitle: 'Cập nhật mới nhất từ thị trường chứng khoán Việt Nam.', loading: 'Đang tải tin tức…', failed: 'Không thể tải tin tức', previous: 'Trang trước', next: 'Trang sau', noMore: 'Không còn trang nào', empty: 'Không tìm thấy tin tức' }
        : { title: 'Market', accent: 'news', subtitle: 'The latest updates from the Vietnamese stock market.', loading: 'Loading news…', failed: 'Unable to load news', previous: 'Previous', next: 'Next', noMore: 'No more pages', empty: 'No news found' };
    const [news, setNews] = useState<NewsItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const pageSize = 50;

    useEffect(() => {
        async function loadNews() {
            try {
                setIsLoading(true);
                const response = await fetch(`/api/market/news?page=${page}&size=${pageSize}&compact=1`);
                if (!response.ok) throw new Error('Failed to fetch news');
                const data = await response.json();
                // Handle API response with Data property
                const newsArray = Array.isArray(data) ? data : (data.Data || data.data || data.news || []);
                setNews(newsArray);
            } catch (err) {
                console.error('Error loading news:', err);
                setError(lang === 'vi' ? 'Không thể tải tin tức' : 'Unable to load news');
            } finally {
                setIsLoading(false);
            }
        }
        loadNews();
    }, [page, lang]);

    const goToPage = (p: number) => {
        const next = Math.max(1, p);
        setPage(next);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const pageButtons = (() => {
        const start = Math.max(1, page - 2);
        const end = page + 2;
        const buttons: number[] = [];
        for (let p = start; p <= end; p++) buttons.push(p);
        return buttons;
    })();

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>{copy.title} <span>{copy.accent}</span></h1>
                <div className={styles.headerAccent} />
                <p className={styles.subtitle}>{copy.subtitle}</p>
            </div>

            {isLoading && (
                <div className={styles.loading}>
                    <div className="spinner" />
                    <span>{copy.loading}</span>
                </div>
            )}

            {error && (
                <div className={styles.error}>
                    <span>⚠️ {error}</span>
                </div>
            )}

            {!isLoading && !error && (
                <>
                <div className={styles.newsList}>
                    {news.map((item, index) => {
                        const title = item.title || item.Title || '';
                        const link = item.url || item.Link || item.NewsUrl || '#';
                        const url = link.startsWith('http') ? link : `https://cafef.vn${link}`;
                        const img = item.image_url || item.ImageThumb || item.Avatar || '';
                        const time = formatRelativeTime(item.publish_date || item.PostDate || item.PublishDate, lang === 'vi' ? 'vi-VN' : 'en-US');
                        const symbol = item.symbol || item.Symbol || '';
                        const change = item.ChangePrice || 0;
                        const isUp = change >= 0;

                        return (
                            <a
                                key={index}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.newsItem}
                            >
                                {/* Thumbnail */}
                                {img && (
                                    <div className={styles.thumbnail}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={img}
                                            alt={title}
                                            loading="lazy"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Content */}
                                <div className={styles.content}>
                                    <h3 className={styles.newsTitle}>{title}</h3>

                                    <div className={styles.meta}>
                                        {time && <span className={styles.time}>{time}</span>}

                                        {symbol && (
                                            <span
                                                className={`${styles.stockTag} ${isUp ? styles.positive : styles.negative}`}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    window.location.href = `/stock/${symbol}`;
                                                }}
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={siteConfig.stockLogoUrl(symbol)}
                                                    alt={symbol}
                                                    className={styles.stockLogo}
                                                    style={{ objectFit: 'contain', backgroundColor: '#fff', padding: '1px' }}
                                                    onError={(e) => {
                                                        const target = e.target as HTMLImageElement;
                                                        if (!target.src.includes('/logos/')) {
                                                            target.src = `/logos/${symbol}.jpg`;
                                                        } else {
                                                            target.style.display = 'none';
                                                        }
                                                    }}
                                                />
                                                {symbol}
                                                {item.Price && ` ${item.Price}`}
                                                {change !== 0 && ` ${isUp ? '+' : ''}${change}`}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </a>
                        );
                    })}
                </div>
                <div className={styles.pagination}>
                    <button
                        className={styles.pageButton}
                        onClick={() => goToPage(page - 1)}
                        disabled={page <= 1 || isLoading}
                    >
                        {copy.previous}
                    </button>

                    {pageButtons.map((p) => (
                        <button
                            key={p}
                            className={`${styles.pageButton} ${p === page ? styles.pageActive : ''}`}
                            onClick={() => goToPage(p)}
                            disabled={isLoading}
                        >
                            {p}
                        </button>
                    ))}

                    <button
                        className={styles.pageButton}
                        onClick={() => goToPage(page + 1)}
                        disabled={isLoading || news.length < pageSize}
                        title={news.length < pageSize ? copy.noMore : ''}
                    >
                        {copy.next}
                    </button>
                </div>
                </>
            )}

            {!isLoading && news.length === 0 && !error && (
                <div className={styles.empty}>
                    <span>{copy.empty}</span>
                </div>
            )}
        </div>
    );
}
