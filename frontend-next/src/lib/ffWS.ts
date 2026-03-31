'use client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FFBar {
  T: string;
  H?: number;
  L?: number;
  O?: number;
  C: number;
  D: number;
}

export interface FFQuote {
  Bid?: number;
  Ask?: number;
  BidRounded?: number;
  AskRounded?: number;
}

export interface FFMessage {
  Name: string;
  Partial?: number;
  Quotes?: Record<string, FFQuote>;
  Bars?: Record<string, FFBar[]>;
  Metrics?: { Metrics?: Record<string, { high?: number; price?: number; low?: number; spread?: number }> };
  Type?: number;
}

export interface FFPrice {
  channel: string;
  price: number;
  dayOpen: number;
  changePercent: number;
}

type Listener = (msg: FFMessage) => void;

// ── Decompress — native browser DecompressionStream, no external lib ─────────

async function decompress(buf: ArrayBuffer): Promise<string> {
  const formats: CompressionFormat[] = ['deflate', 'deflate-raw'];
  for (const fmt of formats) {
    try {
      const ds = new DecompressionStream(fmt);
      const blob = new Blob([buf]);
      const out = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
      return new TextDecoder().decode(out);
    } catch { /* try next format */ }
  }
  throw new Error('ff: decompress failed');
}

// ── Manager ──────────────────────────────────────────────────────────────────

const FF_WS_URL = 'wss://mds-wss.forexfactory.com:2096';

class FFWSManager {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private subscriptions = new Set<string>();
  private failedConnects = 0;
  private partialBuffer = '';
  private destroyed = false;

  connect() {
    if (this.destroyed) return;
    try {
      console.log('[FF] connecting...');
      this.ws = new WebSocket(FF_WS_URL);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        console.log('[FF] connected, subscribing', this.subscriptions.size, 'channels');
        this.failedConnects = 0;
        for (const ch of this.subscriptions) this.sendSub(ch);
      };
      this.ws.onmessage = (e) => this.onMessage(e);
      this.ws.onclose = (e) => {
        console.warn('[FF] closed', e.code, e.reason);
        if (this.destroyed) return;
        this.failedConnects++;
        const delay = Math.min(1000 * this.failedConnects, 30_000);
        setTimeout(() => this.connect(), delay);
      };
      this.ws.onerror = (e) => console.error('[FF] ws error', e);
    } catch (err) {
      console.error('[FF] connect throw', err);
      this.failedConnects++;
      const delay = Math.min(1000 * this.failedConnects, 30_000);
      setTimeout(() => this.connect(), delay);
    }
  }

  private sendSub(ch: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
    this.ws.send(JSON.stringify({ type: 'subscribe', channel: `${ch}.partial` }));
  }

  private sendUnsub(ch: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'unsubscribe', channel: ch }));
  }

  private async onMessage(e: MessageEvent) {
    if (e.data instanceof ArrayBuffer) {
      try {
        const text = await decompress(e.data);
        this.dispatch(text);
      } catch (err) {
        console.error('[FF] decompress failed', err);
      }
      return;
    }
    // Text frame — newline-delimited
    this.partialBuffer += e.data as string;
    if (!this.partialBuffer.includes('\n')) return;
    const lines = this.partialBuffer.split('\n');
    this.partialBuffer = lines.pop()!;
    for (const line of lines) {
      if (line === 'ping') {
        this.ws?.send('pong');
      } else if (line) {
        this.dispatch(line);
      }
    }
  }

  private dispatch(text: string) {
    try {
      const msg: FFMessage = JSON.parse(text);
      if (!msg.Name) return;
      console.log('[FF] msg', msg.Name, msg.Partial ? 'partial' : 'full', 'price:', msg.Quotes?.MDSAgg?.BidRounded);
      const set = this.listeners.get(msg.Name);
      if (set) for (const fn of set) fn(msg);
    } catch { /* ignore */ }
  }

  subscribe(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
    this.listeners.get(channel)!.add(listener);
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.add(channel);
      this.sendSub(channel);
    }
    return () => this.unsubscribe(channel, listener);
  }

  private unsubscribe(channel: string, listener: Listener) {
    const set = this.listeners.get(channel);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(channel);
      this.subscriptions.delete(channel);
      this.sendUnsub(channel);
    }
  }

  destroy() {
    this.destroyed = true;
    this.ws?.close();
  }
}

// Singleton — connect immediately at module load time (client only)
let _manager: FFWSManager | null = null;

export function getFFWS(): FFWSManager {
  if (!_manager) {
    _manager = new FFWSManager();
    _manager.connect();
  }
  return _manager;
}

// Pre-connect as soon as this module is imported on the client
if (typeof window !== 'undefined') getFFWS();

// ── Helper: extract price from a FF message ───────────────────────────────────

export function extractPrice(msg: FFMessage, prevRef?: number): FFPrice | null {
  const agg = msg.Quotes?.MDSAgg;
  if (!agg) return null;

  const price = agg.BidRounded ?? agg.Bid;
  if (price == null) return null;

  let dayOpen = prevRef ?? 0;
  if (!msg.Partial) {
    const d1ref = msg.Metrics?.Metrics?.D1?.price;
    if (d1ref != null && d1ref > 0) dayOpen = d1ref;
  }

  const changePercent = dayOpen > 0 ? ((price - dayOpen) / dayOpen) * 100 : 0;
  return { channel: msg.Name, price, dayOpen, changePercent };
}
