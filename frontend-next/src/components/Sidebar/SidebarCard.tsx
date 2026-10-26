import { Card } from '@tremor/react';
import type { ReactNode } from 'react';

type SidebarCardProps = {
    title: ReactNode;
    status?: ReactNode;
    children: ReactNode;
};

export default function SidebarCard({ title, status, children }: SidebarCardProps) {
    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center justify-between gap-2 px-5 py-5">
                <h2 className="min-w-0 text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{title}</h2>
                {status && <span role="status" className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{status}</span>}
            </div>
            {children}
        </Card>
    );
}
