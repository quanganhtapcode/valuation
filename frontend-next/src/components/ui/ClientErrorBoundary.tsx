'use client';

import { usePathname } from 'next/navigation';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export function ClientErrorBoundary({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    // key=pathname forces ErrorBoundary to remount on every navigation,
    // resetting hasError state so a render error on one page doesn't
    // block subsequent navigation.
    return (
        <ErrorBoundary key={pathname}>
            {children}
        </ErrorBoundary>
    );
}
