"use client"

import { siteConfig } from "@/app/siteConfig"
import useScroll from "@/lib/use-scroll"
import { cx, focusInput } from "@/lib/utils"
import { RiArrowDownSLine, RiCloseLine, RiMenuLine, RiSearchLine } from "@remixicon/react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useDebounce } from "use-debounce"
import React, { useState, useEffect, useRef, useCallback } from "react"
import { DatabaseLogo } from "@/components/DatabaseLogo"
import { Button } from "@/components/Button"
import { getTickerData } from "@/lib/tickerCache"

interface Ticker {
    symbol: string;
    name: string;
    sector: string;
    exchange: string;
}

interface TickerData {
    tickers: Ticker[];
}

const NAV_GROUPS = [
    {
        id: "market",
        label: "Market",
        items: [
            { label: "Overview", href: "/" },
            { label: "Foreign", href: "/foreign" },
            { label: "Macro", href: "/macro" },
        ],
    },
    {
        id: "stocks",
        label: "Stocks",
        items: [
            { label: "Company", href: "/stock/VCB" },
            { label: "Screener", href: "/screener" },
        ],
    },
] as const;

export function Navbar() {
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

    // Close everything on navigation
    useEffect(() => {
        setSearchOpen(false);
        setSearchQuery('');
        setOpen(false);
        setMobileExpanded(null);
        setActiveDropdown(null);
    }, [pathname]);

    useEffect(() => {
        if (searchOpen && window.innerWidth < 768) {
            setOpen(false);
        }
    }, [searchOpen]);

    useEffect(() => {
        const mediaQuery: MediaQueryList = window.matchMedia("(min-width: 768px)")
        const handleMediaQueryChange = () => {
            setOpen(false)
            setSearchOpen(false)
            setMobileExpanded(null)
        }
        mediaQuery.addEventListener("change", handleMediaQueryChange)
        handleMediaQueryChange()
        return () => mediaQuery.removeEventListener("change", handleMediaQueryChange)
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

    // Click outside search
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (searchOpen) {
                let inside = false;
                if (searchRef.current?.contains(target)) inside = true;
                if (mobileSearchRef.current?.contains(target)) inside = true;
                if (!inside) setSearchOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [searchOpen]);

    // Search filtering
    useEffect(() => {
        if (typeof debouncedQuery !== 'string' || debouncedQuery.length < 1) {
            setSearchResults([]);
            return;
        }
        const upperQuery = debouncedQuery.toUpperCase();
        const lowerQuery = debouncedQuery.toLowerCase();
        const filtered = allTickers.filter(ticker => {
            if (!ticker) return false;
            return (ticker.symbol || '').toUpperCase().includes(upperQuery) ||
                (ticker.name || '').toLowerCase().includes(lowerQuery);
        }).sort((a, b) => {
            const sa = (a?.symbol || '').toUpperCase();
            const sb = (b?.symbol || '').toUpperCase();
            if (sa === upperQuery && sb !== upperQuery) return -1;
            if (sb === upperQuery && sa !== upperQuery) return 1;
            if (sa.startsWith(upperQuery) && !sb.startsWith(upperQuery)) return -1;
            if (!sa.startsWith(upperQuery) && sb.startsWith(upperQuery)) return 1;
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

    // Ctrl+K / Cmd+K
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
            if (mobileInputRef.current) {
                setTimeout(() => mobileInputRef.current?.focus(), 100);
            } else if (desktopInputRef.current) {
                setTimeout(() => desktopInputRef.current?.focus(), 50);
            }
        }
    }, [searchOpen]);

    // Hover handlers with delay to prevent flicker
    const handleMouseEnter = (id: string) => {
        if (dropdownTimerRef.current) clearTimeout(dropdownTimerRef.current);
        setActiveDropdown(id);
    };

    const handleMouseLeave = () => {
        dropdownTimerRef.current = setTimeout(() => setActiveDropdown(null), 120);
    };

    return (
        <header
            className={cx(
                "fixed inset-x-2 top-2 z-50 mx-auto flex max-w-6xl transform-gpu animate-slide-down-fade justify-center overflow-visible rounded-xl border border-transparent px-3 py-2.5 md:top-4 md:px-3 md:py-3 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1.03)] will-change-transform",
                open === true ? "h-96" : "h-14 md:h-16",
                scrolled || open === true || searchOpen
                    ? "backdrop-blur-nav max-w-4xl border-gray-100 bg-white/80 shadow-xl shadow-black/5 dark:border-white/15 dark:bg-black/70"
                    : "bg-white/0 dark:bg-gray-950/0",
            )}
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
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-gray-900 dark:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-blue-600 transition-colors"
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
                                            className="absolute left-0 top-full pt-2"
                                            onMouseEnter={() => handleMouseEnter(group.id)}
                                            onMouseLeave={handleMouseLeave}
                                        >
                                            <div className="min-w-[160px] rounded-xl border border-gray-200 bg-white/95 py-1.5 shadow-xl shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/95">
                                                {group.items.map((item) => (
                                                    <Link
                                                        key={item.href}
                                                        href={item.href}
                                                        className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                                    >
                                                        {item.label}
                                                    </Link>
                                                ))}
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
                                    placeholder="Search..."
                                    value={searchQuery}
                                    onChange={handleSearch}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && searchResults.length > 0) {
                                            router.push(`/stock/${searchResults[0].symbol}`);
                                            setSearchOpen(false);
                                            setSearchQuery('');
                                        }
                                    }}
                                    onFocus={() => {
                                        setSearchOpen(true);
                                        if (!tickersLoaded) void ensureTickersLoaded();
                                    }}
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
                                        <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-widest">Search Results</span>
                                    </div>
                                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                                        {searchResults.length > 0 ? (
                                            searchResults.map((result) => (
                                                <Link
                                                    key={result.symbol}
                                                    href={`/stock/${result.symbol}`}
                                                    prefetch={false}
                                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20 group"
                                                    onMouseDown={() => {
                                                        router.push(`/stock/${result.symbol}`);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <div className="shrink-0 relative w-8 h-8 rounded-lg bg-white border border-gray-100 dark:border-gray-800 flex items-center justify-center p-1 group-hover:border-blue-200 transition-colors shadow-sm overflow-hidden">
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
                                                            <span className="hidden text-[10px] font-bold text-gray-600 dark:text-gray-400">
                                                                {result.symbol[0]}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="font-bold text-gray-900 dark:text-gray-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                                                {result.symbol}
                                                            </span>
                                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                                                {result.name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                        {result.exchange}
                                                    </span>
                                                </Link>
                                            ))
                                        ) : (
                                            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                                                <p className="text-sm">No results found for &quot;{searchQuery}&quot;</p>
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
                            onClick={() => {
                                setOpen(!open);
                                if (!open) { setSearchOpen(false); setMobileExpanded(null); }
                            }}
                            variant="light"
                            className="aspect-square p-2"
                        >
                            {open ? (
                                <RiCloseLine aria-hidden="true" className="size-5" />
                            ) : (
                                <RiMenuLine aria-hidden="true" className="size-5" />
                            )}
                        </Button>
                    </div>
                </div>

                {/* Mobile Menu */}
                <nav className={cx("my-6 flex ease-in-out will-change-transform md:hidden", open ? "" : "hidden")}>
                    <ul className="w-full space-y-1 font-medium">
                        {NAV_GROUPS.map((group) => (
                            <li key={group.id}>
                                <button
                                    className="flex w-full items-center justify-between rounded-lg px-2 py-2.5 text-lg text-gray-900 dark:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    onClick={() => setMobileExpanded(prev => prev === group.id ? null : group.id)}
                                >
                                    {group.label}
                                    <RiArrowDownSLine
                                        className={cx(
                                            "size-5 transition-transform duration-200",
                                            mobileExpanded === group.id ? "rotate-180" : ""
                                        )}
                                    />
                                </button>
                                {mobileExpanded === group.id && (
                                    <ul className="mt-1 ml-3 space-y-1 border-l-2 border-gray-100 dark:border-gray-800 pl-3">
                                        {group.items.map((item) => (
                                            <li key={item.href} onClick={() => setOpen(false)}>
                                                <Link
                                                    href={item.href}
                                                    className="block rounded-lg px-2 py-2 text-base text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                                >
                                                    {item.label}
                                                </Link>
                                            </li>
                                        ))}
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
                                    placeholder="Search stock symbol..."
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
                                            onMouseDown={() => { router.push(`/stock/${result.symbol}`); }}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-gray-900 dark:text-gray-50">{result.symbol}</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{result.exchange}</span>
                                            </div>
                                            <span className="truncate text-xs text-gray-500 dark:text-gray-400 max-w-[120px]">{result.name}</span>
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
