"use client"
import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import { assertTranslationParity, translations, type Lang } from "@/lib/translations"

interface LanguageContextValue {
    lang: Lang
    setLanguage: (l: Lang) => void
}

const LanguageContext = createContext<LanguageContextValue>({
    lang: "en",
    setLanguage: () => {},
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [lang, setLang] = useState<Lang>("en")
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") assertTranslationParity()
        const stored = localStorage.getItem("lang") as Lang | null
        queueMicrotask(() => {
            if (stored === "vi" || stored === "en") setLang(stored)
            setMounted(true)
        })
    }, [])

    useEffect(() => {
        document.documentElement.lang = lang === "vi" ? "vi-VN" : "en-US"
        document.documentElement.dir = "ltr"
    }, [lang])

    const setLanguage = (l: Lang) => {
        setLang(l)
        localStorage.setItem("lang", l)
    }

    if (!mounted) return <>{children}</>

    return (
        <LanguageContext.Provider value={{ lang, setLanguage }}>
            {children}
        </LanguageContext.Provider>
    )
}

export function useLanguage() {
    return useContext(LanguageContext)
}

/** Shared locale-aware formatting for values that must not be translated inline. */
export function useI18n() {
    const { lang, setLanguage } = useLanguage()
    const locale = lang === "vi" ? "vi-VN" : "en-US"
    const formatters = useMemo(() => ({
        number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value),
        date: (value: string | Date, options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }) =>
            new Intl.DateTimeFormat(locale, options).format(typeof value === "string" ? new Date(value) : value),
        vnd: (value: number, unit: "million" | "billion" | "trillion" = "billion") => {
            const divisor = unit === "million" ? 1e6 : unit === "billion" ? 1e9 : 1e12
            const label = lang === "vi"
                ? (unit === "million" ? "triệu VND" : unit === "billion" ? "tỷ VND" : "nghìn tỷ VND")
                : `${unit} VND`
            return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / divisor)} ${label}`
        },
    }), [lang, locale])

    return { lang, locale, setLanguage, messages: translations[lang], ...formatters }
}
