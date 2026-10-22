/** Decode shared ranges in display units, rejecting non-finite values and inverted bounds. */
export function sharedRange(params: URLSearchParams, prefix: string, bounds: { min: number; max: number }, scale = 1) {
  const read = (side: 'min' | 'max') => {
    const raw = params.get(`${prefix}_${side}`);
    const value = raw === null || raw.trim() === '' ? bounds[side] : Number(raw) / scale;
    return Number.isFinite(value) ? Math.max(bounds.min, Math.min(bounds.max, value)) : bounds[side];
  };
  const min = read('min'), max = read('max');
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function sharedSymbols(value: string | null): string[] {
  return [...new Set((value ?? '').split(',').map(symbol => symbol.trim().toUpperCase()).filter(symbol => /^[A-Z0-9]{2,10}$/.test(symbol)))].slice(0, 5);
}
