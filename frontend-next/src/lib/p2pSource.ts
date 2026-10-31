const OKX_BASE = 'https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=VND&baseCurrency=USDT&paymentMethod=all&showTrade=false&hideOverseasVerificationAds=false&acceptsVoucher=false&isAbleFilter=false&showFollow=false&showAlreadyTraded=false&userType=all';
const BINANCE_BASE = 'https://www.binance.com/bapi/c2c/v1/public/c2c/agent/ad-list?fiat=VND&asset=USDT&limit=20';
const CHOGIA_URL = 'https://chogia.vn/get-live-price.php?k=8fgY0d9s%25238g023j5lagu9%25248G72935jsaf987DF2935%255EuflskaB%2540j9873Y5&t=currencynames';
const AMOUNT = 1000;
const MIN_RATE = 0.95;

type Offer = { price: number; seller: string; completionRate: number; positiveRate: number | null; available: number; orders: number; min: number; max: number; id: string };
type Result = { offer: Offer | null; error: boolean; scanned: number };
type Exchange = 'okx' | 'binance';
type Direction = 'buy' | 'sell'; // The user's direction.

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function getOffer(exchange: Exchange, direction: Direction): Promise<Result> {
    const okxSide = direction === 'buy' ? 'sell' : 'buy';
    const url = exchange === 'okx'
        ? `${OKX_BASE}&side=${okxSide}&sortType=${direction === 'buy' ? 'price_asc' : 'price_desc'}`
        : `${BINANCE_BASE}&tradeType=${direction.toUpperCase()}`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
        if (!response.ok) throw new Error('Upstream request failed');
        const body = await response.json();
        if (exchange === 'okx' ? body.code !== 0 : body.success !== true) throw new Error('Upstream error');
        const ads = exchange === 'okx' ? body.data?.[okxSide] : body.data?.items;
        if (!Array.isArray(ads)) throw new Error('Invalid response');
        const offers: Offer[] = ads.flatMap((ad): Offer[] => {
            // Exclude OKX ads that require a specific counterparty trading history
            // or account age; those quotes are not generally available.
            if (exchange === 'okx' && (
                Number(ad.minCompletedOrderQuantity || 0) > 0 ||
                Number(ad.maxCompletedOrderQuantity ?? -1) >= 0 ||
                Number(ad.minSellOrderQuantity || 0) > 0 ||
                Number(ad.minSellOrders || 0) > 0 ||
                Number(ad.minCompletionRate || 0) > 0 ||
                Number(ad.minTradeVolume || 0) > 0 ||
                Number(ad.maxUserCreatedDate || 0) > 0
            )) return [];
            const price = numberOrNull(ad.price);
            const completionRate = numberOrNull(exchange === 'okx' ? ad.completedRate : ad.advertiser?.monthFinishRate);
            const available = numberOrNull(exchange === 'okx' ? ad.availableAmount : ad.tradableAmount);
            const orders = numberOrNull(exchange === 'okx' ? ad.completedOrderQuantity : ad.advertiser?.monthOrderCount);
            // OKX limits are VND; Binance's agent API limits are USDT quantities.
            const min = numberOrNull(exchange === 'okx' ? ad.quoteMinAmountPerOrder : ad.minTransAmount);
            const max = numberOrNull(exchange === 'okx' ? ad.quoteMaxAmountPerOrder : ad.maxTransAmount);
            const seller = exchange === 'okx' ? ad.nickName : ad.advertiser?.nickName;
            const id = exchange === 'okx' ? ad.id : ad.adNo;
            const rawPositive = numberOrNull(exchange === 'okx' ? ad.posReviewPercentage : ad.advertiser?.positiveRate);
            const positiveRate = rawPositive !== null && rawPositive >= 0 && rawPositive <= 1 ? rawPositive : null;
            if (price === null || price <= 0 || completionRate === null || completionRate < MIN_RATE || completionRate > 1 ||
                available === null || available < AMOUNT || orders === null || orders <= 0 || min === null || max === null ||
                typeof seller !== 'string' || !seller || typeof id !== 'string') return [];
            const tradeAmount = exchange === 'okx' ? AMOUNT * price : AMOUNT;
            if (min > tradeAmount || max < tradeAmount) return [];
            return [{ price, seller, completionRate, positiveRate, available, orders, min, max, id }];
        });
        offers.sort((a, b) => direction === 'buy' ? a.price - b.price : b.price - a.price);
        return { offer: offers[0] ?? null, error: false, scanned: ads.length };
    } catch {
        return { offer: null, error: true, scanned: 0 };
    }
}

async function getCashUsd(): Promise<{ buy: number; sell: number } | null> {
    try {
        const response = await fetch(CHOGIA_URL, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
        if (!response.ok) return null;
        const html = await response.text();
        const getPrice = (id: string) => {
            const tag = html.match(new RegExp(`<td\\b[^>]*\\bid=['"]${id}['"][^>]*>`, 'i'))?.[0];
            return numberOrNull(tag?.match(/\bdata-price=['"]([\d.]+)['"]/i)?.[1]);
        };
        // Source buy/sell describes the exchange's perspective.
        const buy = getPrice('usd-sell');
        const sell = getPrice('usd-buy');
        return buy !== null && sell !== null && buy > 0 && sell > 0 ? { buy, sell } : null;
    } catch {
        return null;
    }
}

type BankRate = { buy: number; sell: number; date: string; updatedAt: string };
let bankCache: { value: BankRate | null; fetchedAt: number } | undefined;

async function getBankUsd(): Promise<BankRate | null> {
    if (bankCache && Date.now() - bankCache.fetchedAt < (bankCache.value ? 300_000 : 60_000)) return bankCache.value;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const date = new Date(`${today}T00:00:00Z`);
    try {
        for (let i = 0; i < 7; i++) {
            const day = date.toISOString().slice(0, 10);
            const response = await fetch(`https://www.vietcombank.com.vn/api/exchangerates?date=${day}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
            if (!response.ok) break;
            const body = await response.json();
            if (!Array.isArray(body.Data)) break;
            const usd = body.Data.find((item: { currencyCode?: string }) => item.currencyCode === 'USD');
            if (usd) {
                const buy = numberOrNull(usd.sell);
                const sell = numberOrNull(usd.cash);
                if (buy && sell && buy > 0 && sell > 0) {
                    const updatedAt = typeof body.UpdatedDate === 'string' ? body.UpdatedDate : '';
                    const value = { buy, sell, date: /^\d{4}-\d{2}-\d{2}T/.test(updatedAt) ? updatedAt.slice(0, 10) : day, updatedAt };
                    bankCache = { value, fetchedAt: Date.now() };
                    return value;
                }
                break;
            }
            date.setUTCDate(date.getUTCDate() - 1);
        }
    } catch {
        // Show unavailable when the source cannot be reached.
    }
    bankCache = { value: null, fetchedAt: Date.now() };
    return null;
}

let cached: { okx: { buy: Result; sell: Result }; binance: { buy: Result; sell: Result }; cashUsd: { buy: number; sell: number } | null; bankUsd: BankRate | null; fetchedAt: number } | undefined;
let pending: Promise<NonNullable<typeof cached>> | undefined;

export async function getP2PSnapshot() {
    if (!cached || Date.now() - cached.fetchedAt >= 60_000) {
        pending ??= Promise.all([getOffer('okx', 'buy'), getOffer('okx', 'sell'), getOffer('binance', 'buy'), getOffer('binance', 'sell'), getCashUsd(), getBankUsd()])
            .then(([okxBuy, okxSell, binanceBuy, binanceSell, cashUsd, bankUsd]) => ({ okx: { buy: okxBuy, sell: okxSell }, binance: { buy: binanceBuy, sell: binanceSell }, cashUsd, bankUsd, fetchedAt: Date.now() }))
            .finally(() => { pending = undefined; });
        cached = await pending;
    }
    return cached;
}
