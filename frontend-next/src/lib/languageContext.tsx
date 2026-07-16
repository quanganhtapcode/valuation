"use client"
import React, { createContext, useContext, useEffect, useState } from "react"

type Lang = "vi" | "en"

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
        const stored = localStorage.getItem("lang") as Lang | null
        queueMicrotask(() => {
            if (stored === "vi" || stored === "en") setLang(stored)
            setMounted(true)
        })
    }, [])

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
