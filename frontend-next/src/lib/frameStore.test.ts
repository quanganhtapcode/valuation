import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameStore } from './frameStore';

test('pointer samples notify only leaf subscribers once per frame, with the newest value', () => {
    let callback: FrameRequestCallback | undefined;
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let scheduled = 0;
    let cancelled = 0;
    globalThis.requestAnimationFrame = fn => { callback = fn; return ++scheduled; };
    globalThis.cancelAnimationFrame = () => { cancelled++; };
    try {
        const store = createFrameStore<number | null>(null);
        const seen: (number | null)[] = [];
        const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
        for (let i = 0; i < 100; i++) store.publish(i);
        assert.equal(scheduled, 1);
        assert.equal(store.getSnapshot(), null);
        callback?.(0);
        assert.deepEqual(seen, [99]);
        store.publish(null);
        callback?.(1);
        assert.deepEqual(seen, [99, null]);
        unsubscribe();
        store.publish(123);
        store.dispose();
        assert.equal(cancelled, 1);
        assert.equal(store.getSnapshot(), null);
    } finally {
        globalThis.requestAnimationFrame = originalRequest;
        globalThis.cancelAnimationFrame = originalCancel;
    }
});
