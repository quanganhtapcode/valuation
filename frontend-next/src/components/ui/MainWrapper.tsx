'use client';

import { isStockDetailPath } from '@/lib/localePath';

import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStockPage = isStockDetailPath(pathname);
  // Stock pages: no ticker tape, so less top padding needed
  const paddingClass = isStockPage
    ? 'pt-[84px]'
    : 'pt-[116px]';
  return (
    <main className={`${paddingClass} min-h-[calc(100vh-400px)]`}>
      {children}
    </main>
  );
}
