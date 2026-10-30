// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebUpdater, type UpdaterState, type WebUpdaterOptions } from './updater.js';

interface Fixtures {
  component: string;
  publicKey: string;
  manifests: Record<'notify' | 'reload', { manifest: string; signature: string }>;
}

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../../../spec/fixtures/client/signed-manifests.json', import.meta.url),
    'utf8',
  ),
) as Fixtures;

const MANIFEST_URL = 'https://example.github.io/example-web/latest.json';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function fakeDocument() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    fire: () => listeners.forEach((listener) => listener()),
    listeners,
  };
}

function setup(overrides: Partial<WebUpdaterOptions> = {}, which: 'notify' | 'reload' = 'notify') {
  let time = new Date('2026-12-01T00:00:00Z').getTime();
  const requests: string[] = [];
  const { manifest, signature } = fixtures.manifests[which];
  const fetch: typeof globalThis.fetch = (input) => {
    requests.push(String(input));
    const body = String(input).endsWith('.sig') ? signature : manifest;
    return Promise.resolve(new Response(body));
  };
  const document = fakeDocument();
  const opened: string[] = [];
  const reload = vi.fn();
  const updater = createWebUpdater({
    component: fixtures.component,
    currentVersion: '1.6.0',
    manifestUrl: MANIFEST_URL,
    trustedKeys: [fixtures.publicKey],
    fetch,
    storage: memoryStorage(),
    now: () => new Date(time),
    document,
    location: { reload },
    open: (url) => opened.push(url),
    ...overrides,
  });
  return {
    updater,
    requests,
    document,
    opened,
    reload,
    advance: (ms: number) => (time += ms),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createWebUpdater', () => {
  it('notifies listeners while checking and with the result', async () => {
    const { updater } = setup();
    const states: UpdaterState[] = [];
    updater.subscribe((state) => states.push(state));

    await updater.check();

    expect(states[0]).toMatchObject({ checking: true, result: undefined });
    expect(states.at(-1)).toMatchObject({
      checking: false,
      snoozed: false,
      result: { status: 'available', version: '2.0.0' },
    });
  });

  it('shares a running check between concurrent callers', async () => {
    const { updater, requests } = setup();
    await Promise.all([updater.check(), updater.check(), updater.check()]);
    expect(requests).toHaveLength(2); // one manifest, one signature
  });

  it('postpones optional updates for the snooze period only', async () => {
    const { updater, advance } = setup({ snoozeMs: 1000 });
    await updater.check();
    updater.snooze();
    expect(updater.state.snoozed).toBe(true);
    advance(1001);
    expect(updater.state.snoozed).toBe(false);
  });

  it('never postpones required updates', async () => {
    const { updater } = setup({ currentVersion: '1.4.0' });
    await updater.check();
    expect(updater.state.result?.status).toBe('required');
    updater.snooze();
    expect(updater.state.snoozed).toBe(false);
  });

  it('opens the publisher page for notify entries', async () => {
    const { updater, opened, reload } = setup();
    await updater.check();
    await updater.apply();
    expect(opened).toEqual(['https://github.com/example/example-web/releases/tag/v2.0.0']);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads for reload entries, after the beforeReload hook', async () => {
    const order: string[] = [];
    const { updater, reload } = setup(
      { beforeReload: () => void order.push('beforeReload') },
      'reload',
    );
    reload.mockImplementation(() => order.push('reload'));
    await updater.check();
    await updater.apply();
    expect(order).toEqual(['beforeReload', 'reload']);
  });

  it('does nothing on apply when there is no update', async () => {
    const { updater, opened, reload } = setup({ currentVersion: '2.0.0' });
    await updater.check();
    await updater.apply();
    expect(opened).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps working when storage is blocked', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const { updater } = setup({ storage: blocked });
    expect((await updater.check()).status).toBe('available');
    updater.snooze();
    expect(updater.state.snoozed).toBe(false);
  });

  it('checks on start, periodically and when the tab becomes visible', async () => {
    vi.useFakeTimers();
    const { updater, requests, document } = setup({ checkIntervalMs: 1000 });

    updater.start();
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(4);

    document.fire();
    await vi.waitFor(() => expect(requests).toHaveLength(6));

    updater.stop();
    expect(document.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests).toHaveLength(6);
  });

  it('isolates faulty listeners', async () => {
    const { updater } = setup();
    const healthy = vi.fn();
    updater.subscribe(() => {
      throw new Error('broken listener');
    });
    updater.subscribe(healthy);
    await updater.check();
    expect(healthy).toHaveBeenCalled();
  });
});
