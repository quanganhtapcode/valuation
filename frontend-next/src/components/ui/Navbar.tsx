"use client"

import { siteConfig } from "@/app/siteConfig"
import useScroll from "@/lib/use-scroll"
import { cx, focusInput } from "@/lib/utils"
import { useLanguage } from "@/lib/languageContext"
import { translations } from "@/lib/translations"
import {
    RiArrowDownSLine,
    RiBuilding2Line,
    RiCalendarEventLine,
    RiCloseLine,
    RiFilterLine,
    RiGlobalLine,
    RiLineChartLine,
    RiMenuLine,
    RiPieChartLine,
    RiSearchLine,
} from "@remixicon/react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useDebounce } from "use-debounce"
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { DatabaseLogo } from "@/components/DatabaseLogo"
import { Button } from "@/components/Button"
import { getTickerData } from "@/lib/tickerCache"

interface Ticker {
    symbol: string;
    name: string;
    en_name?: string;
    sector: string;
    en_sector?: string;
    exchange: string;
    isbank?: boolean;
}

interface TickerData {
    tickers: Ticker[];
}

// Height constants for dynamic mobile menu sizing
const HEADER_ROW_H = 56;
const NAV_MARGIN_H = 48;  // my-6 top + bottom
const GROUP_BTN_H = 48;
const SUB_ITEM_H = 44;

export function Navbar() {
    const { lang } = useLanguage()
    const t = translations[lang].nav

    const NAV_GROUPS = [
        {
            id: "market",
            label: t.market,
            items: [
                { label: t.overview, href: "/", icon: RiPieChartLine, desc: t.overviewDesc },
                { label: t.foreign, href: "/foreign", icon: RiGlobalLine, desc: t.foreignDesc },
                { label: t.macro, href: "/macro", icon: RiLineChartLine, desc: t.macroDesc },
                { label: t.events, href: "/events", icon: RiCalendarEventLine, desc: t.eventsDesc },
            ],
        },
        {
            id: "stocks",
            label: t.stocks,
            items: [
                { label: t.company, href: "/stock/VCB", icon: RiBuilding2Line, desc: t.companyDesc },
                { label: t.screener, href: "/screener", icon: RiFilterLine, desc: t.screenerDesc },
                { label: t.news, href: "https://stock.quanganh.org/news", icon: RiCalendarEventLine, desc: t.newsDesc },
            ],
        },
    ]

    const scrolled = useScroll(15)
    const [open, setOpen] = React.useState(false)
    const [mobileExpanded, setMobileExpanded] = useState<string | null>(null)
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery] = useDebounce(searchQuery, 300);
    const [allTickers, setAllTickers] = useState<Ticker[]>([]);
    const [searchResults, setSearchResults] = useState<Ticker[]>([]);
    const [tickersLoaded, setTickersLoaded] = useState(false);
    const tickerLoadingRef = useRef(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const mobileSearchRef = useRef<HTMLDivElement>(null);
    const desktopInputRef = useRef<HTMLInputElement>(null);
    const mobileInputRef = useRef<HTMLInputElement>(null);
    const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const router = useRouter();
    const pathname = usePathname();

    // Compute mobile menu height dynamically to avoid oversized blur
    const mobileOpenHeight = useMemo(() => {
        let h = HEADER_ROW_H + NAV_MARGIN_H + NAV_GROUPS.length * GROUP_BTN_H + (NAV_GROUPS.length - 1) * 4;
        NAV_GROUPS.forEach(g => {
            if (mobileExpanded === g.id) h += g.items.length * SUB_ITEM_H + 4;
        });
        return h + 8; // small buffer
    }, [mobileExpanded]);

    // Close everything on navigation
    useEffect(() => {
        setSearchOpen(false);
        setSearchQuery('');
        setOpen(false);
        setMobileExpanded(null);
        setActiveDropdown(null);
    }, [pathname]);

    useEffect(() => {
        if (searchOpen && window.innerWidth < 768) setOpen(false);
    }, [searchOpen]);

    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)")
        const handle = () => { setOpen(false); setSearchOpen(false); setMobileExpanded(null); }
        mq.addEventListener("change", handle)
        handle()
        return () => mq.removeEventListener("change", handle)
    }, [])

    const ensureTickersLoaded = useCallback(async () => {
        if (tickersLoaded || tickerLoadingRef.current) return;
        tickerLoadingRef.current = true;
        try {
            const data = await getTickerData();
            if (data) setAllTickers((data as TickerData).tickers || []);
            setTickersLoaded(true);
        } finally {
            tickerLoadingRef.current = false;
        }
    }, [tickersLoaded]);

    useEffect(() => {
        if (searchOpen) ensureTickersLoaded();
    }, [searchOpen, ensureTickersLoaded]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (searchOpen) {
                const inside = searchRef.current?.contains(target) || mobileSearchRef.current?.contains(target);
                if (!inside) setSearchOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [searchOpen]);

    useEffect(() => {
        if (typeof debouncedQuery !== 'string' || debouncedQuery.length < 1) {
            setSearchResults([]);
            return;
        }
        const upper = debouncedQuery.toUpperCase();
        const lower = debouncedQuery.toLowerCase();
        const filtered = allTickers.filter(t =>
            t && (
                (t.symbol || '').toUpperCase().includes(upper) ||
                (t.name || '').toLowerCase().includes(lower) ||
                (t.en_name || '').toLowerCase().includes(lower)
            )
        ).sort((a, b) => {
            const sa = (a?.symbol || '').toUpperCase();
            const sb = (b?.symbol || '').toUpperCase();
            if (sa === upper && sb !== upper) return -1;
            if (sb === upper && sa !== upper) return 1;
            if (sa.startsWith(upper) && !sb.startsWith(upper)) return -1;
            if (!sa.startsWith(upper) && sb.startsWith(upper)) return 1;
            return 0;
        }).slice(0, 10);
        setSearchResults(filtered);
    }, [debouncedQuery, allTickers]);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!tickersLoaded) void ensureTickersLoaded();
        setSearchQuery(e.target.value);
    };

    const toggleSearch = () => {
        setSearchOpen(prev => {
            const next = !prev;
            if (next && !tickersLoaded) void ensureTickersLoaded();
            if (next) setOpen(false);
            return next;
        });
    }

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyK' || e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setSearchOpen(true);
                if (window.innerWidth < 768) {
                    setOpen(false);
                    setTimeout(() => mobileInputRef.current?.focus(), 100);
                } else {
                    desktopInputRef.current?.focus();
                }
            }
            if (e.key === 'Escape') setSearchOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [tickersLoaded]);

    useEffect(() => {
        if (searchOpen) {
            if (mobileInputRef.current) setTimeout(() => mobileInputRef.current?.focus(), 100);
            else if (desktopInputRef.current) setTimeout(() => desktopInputRef.current?.focus(), 50);
        }
    }, [searchOpen]);

    const handleMouseEnter = (id: string) => {
        if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current);
        setActiveDropdown(id);
    };
    const handleMouseLeave = () => {
        dropdownTimerRef.current = setTimeout(() => setActiveDropdown(null), 150);
    };

    return (
        <header
            className={cx(
                "fixed inset-x-2 top-2 z-50 mx-auto flex max-w-6xl transform-gpu animate-slide-down-fade justify-center overflow-visible rounded-xl border border-transparent px-3 py-2.5 md:top-4 md:px-3 md:py-3 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1.03)] will-change-transform",
                !open && "h-14 md:h-16",
                scrolled || open || searchOpen
                    ? "backdrop-blur-nav max-w-4xl border-gray-100 bg-white/80 shadow-xl shadow-black/5 dark:border-white/15 dark:bg-black/70"
                    : "bg-white/0 dark:bg-gray-950/0",
            )}
            style={open ? { height: `${mobileOpenHeight}px` } : undefined}
        >
            <div className="w-full md:my-auto">
                <div className="flex items-center justify-between gap-4">
                    {/* Logo */}
                    <div className="flex-shrink-0">
                        <Link href={siteConfig.baseLinks.overview}>
                            <span className="sr-only">Overview</span>
                            <DatabaseLogo className="w-24 md:w-32" />
                        </Link>
                    </div>

                    {/* Desktop Nav */}
                    <nav className="hidden md:flex flex-1 justify-center">
                        <div className="flex items-center gap-1 font-medium">
                            {NAV_GROUPS.map((group) => (
                                <div
                                    key={group.id}
                                    className="relative"
                                    onMouseEnter={() => handleMouseEnter(group.id)}
                                    onMouseLeave={handleMouseLeave}
                                >
                                    <button
                                        className={cx(
                                            "flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                                            activeDropdown === group.id
                                                ? "bg-gray-100 text-blue-600 dark:bg-gray-800 dark:text-blue-400"
                                                : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600"
                                        )}
                                    >
                                        {group.label}
                                        <RiArrowDownSLine
                                            className={cx(
                                                "size-4 transition-transform duration-200",
                                                activeDropdown === group.id ? "rotate-180" : ""
                                            )}
                                        />
                                    </button>

                                    {/* Dropdown panel */}
                                    {activeDropdown === group.id && (
                                        <div
                                            className="absolute left-0 top-full pt-2.5"
                                            onMouseEnter={() => handleMouseEnter(group.id)}
                                            onMouseLeave={handleMouseLeave}
                                        >
                                            {/* Arrow caret */}
                                            <div className="absolute left-4 top-[6px] size-2.5 rotate-45 border-l border-t border-gray-200 bg-white dark:border-white/10 dark:bg-gray-900" />
                                            <div className="min-w-[200px] rounded-xl border border-gray-200 bg-white shadow-xl shadow-black/10 dark:border-white/10 dark:bg-gray-900 overflow-hidden">
                                                {group.items.map((item) => {
                                                    const Icon = item.icon;
                                                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                                                    return (
                                                        <Link
                                                            key={item.href}
                                                            href={item.href}
                                                            className={cx(
                                                                "flex items-center gap-3 px-4 py-3 transition-colors",
                                                                isActive
                                                                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                                                                    : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                                                            )}
                                                        >
                                                            <div className={cx(
                                                                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                                                                isActive
                                                                    ? "bg-blue-100 dark:bg-blue-900/40"
                                                                    : "bg-gray-100 dark:bg-gray-800"
                                                            )}>
                                                                <Icon className={cx(
                                                                    "size-4",
                                                                    isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"
                                                                )} />
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-medium leading-tight">{item.label}</span>
                                                                <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight mt-0.5">{item.desc}</span>
                                                            </div>
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </nav>

                    {/* Desktop Search */}
                    <div className="hidden items-center md:flex">
                        <div className="relative" ref={searchRef}>
                            <div className="relative group">
                                <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                <input
                                    ref={desktopInputRef}
                                    type="text"
                                    className={cx(
                                        "w-32 lg:w-48 rounded-full border border-gray-200 bg-gray-50/50 py-1.5 pl-9 pr-4 text-sm outline-none transition-all placeholder:text-gray-500 focus:w-64 lg:focus:w-72 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50 dark:placeholder:text-gray-400 dark:focus:border-blue-500",
                                        focusInput
                                    )}
                                    placeholder={t.searchPlaceholder}
                                    value={searchQuery}
                                    onChange={handleSearch}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && searchResults.length > 0) {
                                            router.push(`/stock/${searchResults[0].symbol}`);
                                            setSearchOpen(false);
                                            setSearchQuery('');
                                        }
                                    }}
                                    onFocus={() => { setSearchOpen(true); if (!tickersLoaded) void ensureTickersLoaded(); }}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center group-focus-within:opacity-100 opacity-0 transition-opacity pointer-events-none">
                                    <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-gray-200 bg-gray-100 px-1.5 font-mono text-[10px] font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
                                        ⌘K
                                    </kbd>
                                </div>
                            </div>

                            {searchOpen && searchQuery && (
                                <div className="absolute right-0 top-full mt-2 w-[320px] lg:w-[400px] rounded-xl border border-gray-200 bg-white p-2 shadow-2xl shadow-blue-500/10 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/95 overflow-hidden">
                                    <div className="px-2 py-1 mb-1">
                                        <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">{t.searchResults}</span>
                                    </div>
                                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                        {searchResults.length > 0 ? (
                                            searchResults.map((result) => (
                                                <Link
                                                    key={result.symbol}
                                                    href={`/stock/${result.symbol}`}
                                                    prefetch={false}
                                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20 group"
                                                    onMouseDown={() => router.push(`/stock/${result.symbol}`)}
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="shrink-0 relative w-8 h-8 rounded-lg bg-white border border-gray-100 dark:border-gray-800 flex items-center justify-center p-1 group-hover:border-blue-200 transition-colors shadow-sm overflow-hidden">
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img
                                                                src={siteConfig.stockLogoUrl(result.symbol)}
                                                                alt={result.symbol}
                                                                className="w-full h-full object-contain"
                                                                onError={(e) => {
                                                                    const target = e.target as HTMLImageElement;
                                                                    if (!target.src.includes('/logos/')) {
                                                                        target.src = `/logos/${result.symbol}.jpg`;
                                                                    } else {
                                                                        target.style.display = 'none';
                                                                        target.nextElementSibling?.classList.remove('hidden');
                                                                    }
                                                                }}
                                                            />
                                                            <span className="hidden text-[10px] font-bold text-gray-600 dark:text-gray-400">{result.symbol[0]}</span>
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-gray-900 dark:text-gray-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{result.symbol}</span>
                                                                {result.isbank && (
                                                                    <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400 leading-none">BANK</span>
                                                                )}
                                                            </div>
                                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                                                {lang === "en" && result.en_name ? result.en_name : result.name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">{result.exchange}</span>
                                                </Link>
                                            ))
                                        ) : (
                                            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                                                <p className="text-sm">{t.noResults} &quot;{searchQuery}&quot;</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Mobile: Search + Hamburger */}
                    <div className="flex gap-x-2 md:hidden">
                        <Button onClick={toggleSearch} variant="ghost" className="aspect-square p-2">
                            <RiSearchLine className="size-5" />
                        </Button>
                        <Button
                            onClick={() => { setOpen(!open); if (!open) { setSearchOpen(false); setMobileExpanded(null); } }}
                            variant="light"
                            className="aspect-square p-2"
                        >
                            {open ? <RiCloseLine aria-hidden="true" className="size-5" /> : <RiMenuLine aria-hidden="true" className="size-5" />}
                        </Button>
                    </div>
                </div>

                {/* Mobile Menu */}
                <nav className={cx("my-6 flex ease-in-out will-change-transform md:hidden", open ? "" : "hidden")}>
                    <ul className="w-full space-y-1 font-medium">
                        {NAV_GROUPS.map((group) => (
                            <li key={group.id}>
                                <button
                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-base font-semibold text-gray-900 dark:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    onClick={() => setMobileExpanded(prev => prev === group.id ? null : group.id)}
                                >
                                    {group.label}
                                    <RiArrowDownSLine className={cx("size-5 transition-transform duration-200", mobileExpanded === group.id ? "rotate-180" : "")} />
                                </button>
                                {mobileExpanded === group.id && (
                                    <ul className="mt-1 ml-2 space-y-0.5 border-l-2 border-gray-100 dark:border-gray-800 pl-3">
                                        {group.items.map((item) => {
                                            const Icon = item.icon;
                                            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                                            return (
                                                <li key={item.href} onClick={() => setOpen(false)}>
                                                    <Link
                                                        href={item.href}
                                                        className={cx(
                                                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                                                            isActive
                                                                ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
                                                                : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                                                        )}
                                                    >
                                                        <Icon className="size-4 shrink-0" />
                                                        {item.label}
                                                    </Link>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </li>
                        ))}
                    </ul>
                </nav>

                {/* Mobile Search Overlay */}
                {searchOpen && (
                    <div className="absolute left-0 top-16 z-50 w-full md:hidden" ref={mobileSearchRef}>
                        <div className="mx-auto max-w-sm rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-950">
                            <div className="relative">
                                <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
                                <input
                                    ref={mobileInputRef}
                                    type="text"
                                    autoFocus
                                    className={cx(
                                        "w-full rounded-md border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm outline-none transition-all placeholder:text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-50 dark:placeholder:text-gray-400",
                                        focusInput
                                    )}
                                    placeholder={t.searchPlaceholder}
                                    value={searchQuery}
                                    onChange={handleSearch}
                                    onFocus={() => { if (!tickersLoaded) void ensureTickersLoaded(); }}
                                />
                            </div>
                            {searchResults.length > 0 && (
                                <div className="mt-2 max-h-64 overflow-y-auto">
                                    {searchResults.map((result) => (
                                        <Link
                                            key={result.symbol}
                                            href={`/stock/${result.symbol}`}
                                            prefetch={false}
                                            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-900"
                                            onMouseDown={() => router.push(`/stock/${result.symbol}`)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-gray-900 dark:text-gray-50">{result.symbol}</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{result.exchange}</span>
                                            </div>
                                            <span className="truncate text-xs text-gray-500 dark:text-gray-400 max-w-[120px]">
                                                {lang === "en" && result.en_name ? result.en_name : result.name}
                                            </span>
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </header>
    )
}
