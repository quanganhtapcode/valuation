'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getNewsPublishers, type NewsPublisher } from '@/lib/newsPublishers';

function PublisherLogo({ publisher }: { publisher: NewsPublisher }) {
    const [failed, setFailed] = useState(false);
    return (
        <a
            href={publisher.url}
            target="_blank"
            rel="noopener noreferrer"
            title={publisher.name}
            aria-label={publisher.name}
            className="inline-flex min-h-10 items-center rounded px-2 py-1 transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            style={{ backgroundColor: failed ? undefined : publisher.background || '#ffffff' }}
        >
            {failed ? <span className="text-xs font-medium">{publisher.name}</span> : (
                <Image
                    src={publisher.logo}
                    alt={publisher.name}
                    width={publisher.width}
                    height={publisher.height}
                    unoptimized
                    className="h-7 w-auto max-w-40 object-contain"
                    onError={() => setFailed(true)}
                />
            )}
        </a>
    );
}

export default function NewsSourceLogos({ sources, label }: {
    sources?: ReadonlyArray<{ url: string; source?: string }>;
    label: string;
}) {
    const publishers = getNewsPublishers(sources);
    if (!publishers.length) return null;
    return (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-gray-500 dark:text-gray-400">
            <span className="text-xs font-medium">{label}:</span>
            {publishers.map(publisher => <PublisherLogo key={publisher.domain} publisher={publisher} />)}
        </div>
    );
}
