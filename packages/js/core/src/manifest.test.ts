// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestError, validateManifest } from './manifest.js';

const fixtures = new URL('../../../../spec/fixtures/', import.meta.url);

function load(folder: 'valid' | 'invalid'): [string, unknown][] {
  const dir = new URL(`${folder}/`, fixtures);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as unknown]);
}

// The same fixtures are checked against the JSON Schema by spec/scripts/validate-fixtures.mjs,
// so passing both proves the hand-written validator matches the schema on every case.
describe('validateManifest (shared schema fixtures)', () => {
  it.each(load('valid'))('accepts valid/%s', (_name, manifest) => {
    expect(validateManifest(manifest)).toEqual(manifest);
  });

  it.each(load('invalid'))('rejects invalid/%s', (_name, manifest) => {
    expect(() => validateManifest(manifest)).toThrow(ManifestError);
  });
});

describe('validateManifest', () => {
  const minimal = {
    schemaVersion: 1,
    component: 'example-app',
    version: '1.0.0',
    publishedAt: '2026-11-01T10:00:00Z',
    expiresAt: '2027-05-01T10:00:00Z',
    platforms: { web: { action: 'reload' } },
  };

  it('rejects a __proto__ key instead of treating it specially', () => {
    const manifest: unknown = JSON.parse(
      `{"__proto__":{"polluted":true},${JSON.stringify(minimal).slice(1)}`,
    );
    expect(() => validateManifest(manifest)).toThrow(
      expect.objectContaining({ path: '/__proto__' }),
    );
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reports the path of the first problem', () => {
    const manifest = {
      ...minimal,
      platforms: { web: { action: 'reload', url: 'https://example.com' } },
    };
    expect(() => validateManifest(manifest)).toThrow(
      expect.objectContaining({ code: 'invalid-manifest', path: '/platforms/web/url' }),
    );
  });

  it('rejects values that are not objects', () => {
    for (const value of [null, [], 'manifest', 42]) {
      expect(() => validateManifest(value)).toThrow(ManifestError);
    }
  });
});
