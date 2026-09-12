'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function DeferredPanel({ children, height = 192 }: { children: ReactNode; height?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (!('IntersectionObserver' in window)) {
            queueMicrotask(() => setReady(true));
            return;
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setReady(true);
                observer.disconnect();
            }
        }, { rootMargin: '200px' });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={ref} style={ready ? undefined : { minHeight: height }}>{ready ? children : null}</div>;
}
