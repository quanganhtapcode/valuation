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

export function LanguageProvider({ children, initialLang = "vi" }: { children: React.ReactNode; initialLang?: Lang }) {
    const [lang, setLang] = useState<Lang>(initialLang)

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") assertTranslationParity()
    }, [])

    useEffect(() => {
        document.documentElement.lang = translations[lang].overview.locale
        document.documentElement.dir = "ltr"
    }, [lang])

    const setLanguage = (l: Lang) => {
        setLang(l)
        localStorage.setItem("lang", l)
        document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`
    }

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
    const locale = translations[lang].overview.locale
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
