'use client';

import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStockPage = pathname?.startsWith('/stock/');
  // Stock pages: no ticker tape, so less top padding needed
  const paddingClass = isStockPage
    ? 'pt-[80px] md:pt-[100px]'
    : 'pt-[112px] md:pt-[140px]';
  return (
    <main className={`${paddingClass} min-h-[calc(100vh-400px)]`}>
      {children}
    </main>
  );
}
