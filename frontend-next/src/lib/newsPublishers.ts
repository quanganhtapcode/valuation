interface PublisherBrand {
    name: string;
    logo: string;
    width: number;
    height: number;
    background?: string;
}

export interface NewsPublisher extends PublisherBrand {
    domain: string;
    url: string;
}

// Official publisher artwork, stored locally. See docs/news-publisher-logos.md.
const PUBLISHERS: Record<string, PublisherBrand> = {
    "vietstock.vn": {
        "name": "Vietstock",
        "logo": "/news-logos/vietstock.webp",
        "width": 252,
        "height": 80
    },
    "diendandoanhnghiep.vn": {
        "name": "Diễn đàn Doanh nghiệp",
        "logo": "/news-logos/diendandoanhnghiep.webp",
        "width": 299,
        "height": 128
    },
    "fireant.vn": {
        "name": "FireAnt",
        "logo": "/news-logos/fireant.webp",
        "width": 128,
        "height": 128
    },
    "nguoiquansat.vn": {
        "name": "Người quan sát",
        "logo": "/news-logos/nguoiquansat.webp",
        "width": 436,
        "height": 110
    },
    "markettimes.vn": {
        "name": "Markettimes",
        "logo": "/news-logos/markettimes.webp",
        "width": 512,
        "height": 101
    },
    "tinnhanhchungkhoan.vn": {
        "name": "Tin nhanh chứng khoán",
        "logo": "/news-logos/tinnhanhchungkhoan.webp",
        "width": 250,
        "height": 81
    },
    "cafef.vn": {
        "name": "CafeF",
        "logo": "/news-logos/cafef.webp",
        "width": 169,
        "height": 42
    },
    "nhadautu.vn": {
        "name": "Nhà đầu tư",
        "logo": "/news-logos/nhadautu.webp",
        "width": 260,
        "height": 84
    },
    "vietnamfinance.vn": {
        "name": "VietnamFinance",
        "logo": "/news-logos/vietnamfinance.webp",
        "width": 256,
        "height": 128
    },
    "vnbusiness.vn": {
        "name": "VnBusiness",
        "logo": "/news-logos/vnbusiness.webp",
        "width": 512,
        "height": 75
    },
    "sggp.org.vn": {
        "name": "Sài Gòn Giải Phóng",
        "logo": "/news-logos/sggp.webp",
        "width": 125,
        "height": 40
    },
    "vneconomy.vn": {
        "name": "VnEconomy",
        "logo": "/news-logos/vneconomy.webp",
        "width": 512,
        "height": 123
    },
    "tapchicongthuong.vn": {
        "name": "Tạp chí Công Thương",
        "logo": "/news-logos/tapchicongthuong.webp",
        "width": 512,
        "height": 117,
        "background": "#b91820"
    },
    "baodautu.vn": {
        "name": "Báo Đầu tư",
        "logo": "/news-logos/baodautu.webp",
        "width": 380,
        "height": 128
    }
};

export function getNewsPublishers(sources: ReadonlyArray<{ url: string; source?: string }> = []): NewsPublisher[] {
    const publishers: NewsPublisher[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
        try {
            const url = new URL(source.url);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
            const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
            const domain = Object.keys(PUBLISHERS).find(key => hostname === key || hostname.endsWith(`.${key}`)) || hostname;
            if (seen.has(domain)) continue;
            seen.add(domain);
            const brand = PUBLISHERS[domain] || {
                name: source.source || hostname,
                logo: `https://${hostname}/favicon.ico`,
                width: 32,
                height: 32,
            };
            publishers.push({ ...brand, domain, url: url.href });
        } catch {
            // A malformed link must not hide the other cited publishers.
        }
    }
    return publishers;
}
