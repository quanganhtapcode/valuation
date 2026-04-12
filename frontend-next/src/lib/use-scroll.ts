import { useCallback, useEffect, useState } from "react"

export default function useScroll(threshold: number) {
    const [scrolled, setScrolled] = useState(false)

    const onScroll = useCallback(() => {
        setScrolled(window.scrollY > threshold)
    }, [threshold])

    useEffect(() => {
        window.addEventListener("scroll", onScroll)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        onScroll()
        return () => window.removeEventListener("scroll", onScroll)
    }, [onScroll])

    return scrolled
}
