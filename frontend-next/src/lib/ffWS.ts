'use client';

import { getWsUrl } from '@/lib/api';

export interface FFPrice {
  channel: string;
  price: number;
  dayOpen: number;
  changePercent: number;
}

type Listener = (price: FFPrice) => void;

const WS_PATH = '/ws/market/ff-prices';

class FFWSManager {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private cache = new Map<string, FFPrice>();
  private failedConnects = 0;
  private destroyed = false;

  connect() {
    if (this.destroyed) return;
    try {
      const url = getWsUrl(WS_PATH);
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.failedConnects = 0;
      };
      this.ws.onmessage = (e) => this.onMessage(e);
      this.ws.onclose = () => {
        if (this.destroyed) return;
        this.failedConnects++;
        const delay = Math.min(1000 * this.failedConnects, 30_000);
        setTimeout(() => this.connect(), delay);
      };
    } catch {
      this.failedConnects++;
      setTimeout(() => this.connect(), Math.min(1000 * this.failedConnects, 30_000));
    }
  }

  private onMessage(e: MessageEvent) {
    try {
      const msg = JSON.parse(e.data as string);
      if (msg.type === 'ff_snapshot') {
        const data = msg.data as Record<string, { price: number; dayOpen: number; changePercent: number }>;
        for (const [channel, snap] of Object.entries(data)) {
          this.emit(channel, { channel, ...snap });
        }
      } else if (msg.type === 'ff_update') {
        const d = msg.data as FFPrice;
        this.emit(d.channel, d);
      }
    } catch { /* ignore */ }
  }

  private emit(channel: string, price: FFPrice) {
    this.cache.set(channel, price);
    const set = this.listeners.get(channel);
    if (set) for (const fn of set) fn(price);
  }

  subscribe(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set());
    this.listeners.get(channel)!.add(listener);

    // Deliver cached price immediately so late subscribers don't wait for next update
    const cached = this.cache.get(channel);
    if (cached) listener(cached);

    return () => {
      const set = this.listeners.get(channel);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(channel);
    };
  }

  destroy() {
    this.destroyed = true;
    this.ws?.close();
  }
}

let _manager: FFWSManager | null = null;

export function getFFWS(): FFWSManager {
  if (!_manager) {
    _manager = new FFWSManager();
    _manager.connect();
  }
  return _manager;
}

if (typeof window !== 'undefined') getFFWS();
