import { Card } from '@tremor/react';
import type { ReactNode } from 'react';

type SidebarCardProps = {
    title: ReactNode;
    icon: ReactNode;
    status?: ReactNode;
    children: ReactNode;
};

export default function SidebarCard({ title, icon, status, children }: SidebarCardProps) {
    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center justify-between gap-2 px-5 py-5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">{icon}</span>
                    <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">{title}</h2>
                </div>
                {status && <span role="status" className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{status}</span>}
            </div>
            {children}
        </Card>
    );
}
