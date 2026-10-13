'use client';

import Image from 'next/image';
import { useState } from 'react';
import { fundIssuers } from '@/lib/fundIssuers';

export default function IssuerLogo({ manager, compact = false }: { manager: string; compact?: boolean }) {
    const issuer = fundIssuers[manager];
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    return <span className={`flex shrink-0 items-center justify-center rounded bg-white ${compact ? 'h-7 w-7' : 'h-9 w-9'}`}>
        {issuer && failedUrl !== issuer.logoUrl
            ? <Image src={issuer.logoUrl} alt="" width={compact ? 28 : 36} height={compact ? 28 : 36} unoptimized className={compact ? 'h-7 w-7 object-contain' : 'h-9 w-9 object-contain'} onError={() => setFailedUrl(issuer.logoUrl)} />
            : <span className="text-xs font-semibold text-slate-500">{issuer?.shortName.slice(0, 3) || '—'}</span>}
    </span>;
}

