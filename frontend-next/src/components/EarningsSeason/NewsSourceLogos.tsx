'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getNewsPublishers, type NewsPublisher } from '@/lib/newsPublishers';

function PublisherLogo({ publisher }: { publisher: NewsPublisher }) {
    const [failed, setFailed] = useState(false);
    return (
        <span
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white bg-white dark:border-gray-900"
            style={{ backgroundColor: failed ? undefined : publisher.background || '#ffffff' }}
        >
            {failed ? <span className="text-[9px] font-semibold text-gray-600">{publisher.name.charAt(0)}</span> : (
                <Image
                    src={publisher.logo}
                    alt=""
                    width={publisher.width}
                    height={publisher.height}
                    unoptimized
                    className="h-full w-full object-contain p-0.5"
                    onError={() => setFailed(true)}
                />
            )}
        </span>
    );
}

export default function NewsSourceLogos({ sources, label }: {
    sources?: ReadonlyArray<{ url: string; source?: string }>;
    label: string;
}) {
    const publishers = getNewsPublishers(sources);
    if (!publishers.length) return null;
    return (
        <details className="mb-3 text-gray-500 dark:text-gray-400">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-gray-200 px-2 py-1 text-xs transition-colors hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                <span className="flex -space-x-1.5" aria-hidden="true">
                    {publishers.slice(0, 3).map(publisher => <PublisherLogo key={publisher.domain} publisher={publisher} />)}
                </span>
                <span>{publishers.length} {label.toLocaleLowerCase()}</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
                {publishers.map(publisher => (
                    <a
                        key={publisher.domain}
                        href={publisher.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-xs hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:bg-gray-800 dark:hover:text-blue-400"
                    >
                        <PublisherLogo publisher={publisher} />
                        {publisher.name}
                    </a>
                ))}
            </div>
        </details>
    );
}
