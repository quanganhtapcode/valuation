/** Publish only the newest pointer sample per animation frame to leaf subscribers. */
export function createFrameStore<T>(initial: T) {
    let value = initial;
    let pending = initial;
    let frame: number | null = null;
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => value,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        publish(next: T) {
            pending = next;
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                if (Object.is(value, pending)) return;
                value = pending;
                listeners.forEach(listener => listener());
            });
        },
        dispose() {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null;
            value = pending = initial;
        },
    };
}
