"use client"

import { useEffect, useState } from "react"

export default function useScroll(threshold: number) {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        let previous: boolean | undefined
        const onScroll = () => {
            const next = window.scrollY > threshold
            if (next !== previous) {
                previous = next
                setScrolled(next)
            }
        }
        window.addEventListener("scroll", onScroll, { passive: true })
        // eslint-disable-next-line react-hooks/set-state-in-effect
        onScroll()
        return () => window.removeEventListener("scroll", onScroll)
    }, [threshold])

    return scrolled
}
