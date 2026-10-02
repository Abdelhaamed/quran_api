import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore } from '../src/state/store.js';

// One microtask turn is enough for a queued flush to run.
const tick = () => Promise.resolve();

describe('createStore', () => {
  it('notifies once for a multi-key patch, with the merged key set', async () => {
    const store = createStore({ a: 1, b: 1, c: 1 });
    const seen = [];
    store.subscribe((s, keys) => seen.push([...keys]));

    store.setState({ a: 2 });
    store.setState({ b: 2 });
    store.setState({ c: 2 });
    expect(seen).toHaveLength(0);        // nothing synchronous
    await tick();
    expect(seen).toEqual([['a', 'b', 'c']]);
  });

  it('does not notify when no key actually changed', async () => {
    const store = createStore({ a: 1 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.setState({ a: 1 });
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('merges repeated writes to the same key', async () => {
    const store = createStore({ a: 0 });
    const seen = [];
    store.subscribe((s, keys) => seen.push([...keys]));
    store.setState({ a: 1 });
    store.setState({ a: 2 });
    await tick();
    expect(seen).toEqual([['a']]);
  });

  it('gives every listener the same state snapshot', async () => {
    const store = createStore({ n: 0 });
    let first, second;
    store.subscribe((s) => { first = s; });
    store.subscribe((s) => { second = s; });
    store.setState({ n: 1 });
    await tick();
    expect(first).toBe(second);
  });

  it('keeps notifying later listeners when an earlier one throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ n: 0 });
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    store.subscribe(bad);
    store.subscribe(good);
    store.setState({ n: 1 });
    await tick();
    expect(good).toHaveBeenCalledOnce();
    expect(bad).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('notifies synchronously and once when immediate is set', () => {
    const store = createStore({ a: 1, b: 2 });
    const fn = vi.fn();
    store.subscribe(fn, { immediate: true });
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0]).toEqual({ a: 1, b: 2 });
  });

  it('does not queue a spurious flush from an immediate subscribe', async () => {
    const store = createStore({ a: 1 });
    const fn = vi.fn();
    store.subscribe(fn, { immediate: true });
    await tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('still returns an unsubscribe when an immediate callback throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ a: 1 });
    const off = store.subscribe(() => { throw new Error('boom'); }, { immediate: true });
    expect(typeof off).toBe('function');
    off();                                 // must not throw
    spy.mockRestore();
  });

  it('does not register a listener whose immediate call throws', async () => {
    // This is the half of the leak that `typeof off === 'function'` cannot see.
    // Registering the callback anyway would re-invoke the throw on every
    // subsequent flush, so counting invocations across two setStates is what
    // distinguishes the two orderings. Asserting only that an unsubscribe is
    // returned passes under both, because both return one.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ n: 0 });
    let calls = 0;
    store.subscribe(() => { calls += 1; throw new Error('boom'); }, { immediate: true });
    expect(calls).toBe(1);                 // the immediate call, and only that one

    store.setState({ n: 1 });
    await tick();
    store.setState({ n: 2 });
    await tick();

    // 1 = never registered. 3 = registered, then re-invoked by both flushes.
    expect(calls).toBe(1);
    spy.mockRestore();
  });

  it('still delivers flushes to a listener whose immediate call succeeded', async () => {
    const store = createStore({ n: 0 });
    let calls = 0;
    store.subscribe(() => { calls += 1; }, { immediate: true });
    store.setState({ n: 1 });
    await tick();
    // Gates the other direction: gating registration must not break the normal
    // path, or the fix would trade a leak for a silently dead subscription.
    expect(calls).toBe(2);
  });

  it('stops notifying after unsubscribe', async () => {
    const store = createStore({ n: 0 });
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.setState({ n: 1 });
    await tick();
    off();
    store.setState({ n: 2 });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('survives a re-entrant setState from a listener', async () => {
    const store = createStore({ n: 0 });
    store.subscribe((s) => { if (s.n < 3) store.setState({ n: s.n + 1 }); });
    store.setState({ n: 1 });
    await tick();
    await tick();
    expect(store.getState().n).toBeGreaterThan(1);
  });

  it('does not mutate the initial state object', async () => {
    const initial = { a: 1 };
    const store = createStore(initial);
    store.setState({ a: 2 });
    await tick();
    expect(initial.a).toBe(1);
  });
});
