// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkForUpdate, highestVersionKey, type CheckOptions } from './client.js';

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

/** A fake server answering with the given bodies. */
function server(routes: Record<string, string | Uint8Array<ArrayBuffer> | Response>): typeof fetch {
  return (input) => {
    const route = routes[String(input)];
    if (route === undefined) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(route instanceof Response ? route : new Response(route));
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key: string) => data.get(key),
    set: (key: string, value: string) => void data.set(key, value),
  };
}

function options(overrides: Partial<CheckOptions> = {}, which: 'notify' | 'reload' = 'notify') {
  const { manifest, signature } = fixtures.manifests[which];
  return {
    component: fixtures.component,
    currentVersion: '1.6.0',
    platform: 'web',
    manifestUrl: MANIFEST_URL,
    trustedKeys: [fixtures.publicKey],
    fetch: server({ [MANIFEST_URL]: manifest, [`${MANIFEST_URL}.sig`]: signature }),
    now: () => new Date('2026-12-01T00:00:00Z'),
    ...overrides,
  } satisfies CheckOptions;
}

describe('checkForUpdate', () => {
  it('reports an available update and remembers the accepted version', async () => {
    const storage = memoryStorage();
    const result = await checkForUpdate(options({ storage }));
    expect(result).toMatchObject({
      status: 'available',
      version: '2.0.0',
      notes: 'Bug fixes.',
      entry: {
        action: 'notify',
        url: 'https://github.com/example/example-web/releases/tag/v2.0.0',
      },
    });
    expect(storage.data.get(highestVersionKey(fixtures.component))).toBe('2.0.0');
  });

  it('reports required and up-to-date statuses', async () => {
    expect(await checkForUpdate(options({ currentVersion: '1.4.0' }))).toMatchObject({
      status: 'required',
    });
    expect(await checkForUpdate(options({ currentVersion: '2.0.0' }))).toEqual({
      status: 'up-to-date',
    });
  });

  it('rejects a manifest older than a previously accepted version', async () => {
    const storage = memoryStorage({ [highestVersionKey(fixtures.component)]: '3.0.0' });
    expect(await checkForUpdate(options({ storage }))).toMatchObject({
      status: 'error',
      code: 'rollback',
    });
    expect(storage.data.get(highestVersionKey(fixtures.component))).toBe('3.0.0');
  });

  it('rejects a signature that belongs to another manifest', async () => {
    const result = await checkForUpdate(
      options({
        fetch: server({
          [MANIFEST_URL]: fixtures.manifests.notify.manifest,
          [`${MANIFEST_URL}.sig`]: fixtures.manifests.reload.signature,
        }),
      }),
    );
    expect(result).toMatchObject({ status: 'error', code: 'invalid-signature' });
  });

  it('reports download failures instead of throwing', async () => {
    expect(await checkForUpdate(options({ fetch: server({}) }))).toMatchObject({
      status: 'error',
      code: 'download-failed',
    });
    const offline: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await checkForUpdate(options({ fetch: offline }))).toMatchObject({
      status: 'error',
      code: 'download-failed',
    });
  });

  it('stops reading oversized responses', async () => {
    const huge = new Uint8Array(70_000);
    const declared = new Response('{}', { headers: { 'content-length': '70000' } });
    for (const body of [huge, declared]) {
      const result = await checkForUpdate(
        options({
          fetch: server({
            [MANIFEST_URL]: body,
            [`${MANIFEST_URL}.sig`]: fixtures.manifests.notify.signature,
          }),
        }),
      );
      expect(result).toMatchObject({ status: 'error', code: 'manifest-too-large' });
    }
  });

  it('times out slow servers', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    expect(await checkForUpdate(options({ fetch: hanging, timeoutMs: 10 }))).toMatchObject({
      status: 'error',
      code: 'download-failed',
    });
  });

  it('rejects an invalid configuration', async () => {
    const cases: Partial<CheckOptions>[] = [
      { manifestUrl: 'http://example.github.io/latest.json' },
      { currentVersion: 'v1.0.0' },
      { trustedKeys: [] },
      { trustedKeys: ['not a key'] },
    ];
    for (const overrides of cases) {
      expect(await checkForUpdate(options(overrides))).toMatchObject({
        status: 'error',
        code: 'invalid-configuration',
      });
    }
  });

  it('allows plain HTTP on localhost for development', async () => {
    const url = 'http://localhost:4200/latest.json';
    const result = await checkForUpdate(
      options({
        manifestUrl: url,
        fetch: server({
          [url]: fixtures.manifests.notify.manifest,
          [`${url}.sig`]: fixtures.manifests.notify.signature,
        }),
      }),
    );
    expect(result.status).toBe('available');
  });
});
