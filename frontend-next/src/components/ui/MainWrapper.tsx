'use client';

import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStockPage = pathname?.startsWith('/stock/');
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
