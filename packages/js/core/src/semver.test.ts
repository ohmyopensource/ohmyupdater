// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, satisfies, type Version } from './semver.js';

const vectors = JSON.parse(
  readFileSync(new URL('../../../../spec/fixtures/versions/cases.json', import.meta.url), 'utf8'),
) as { compare: [string, string, number][]; satisfies: [string, string, boolean | null][] };

function version(text: string): Version {
  const parsed = parseVersion(text);
  if (parsed === undefined) throw new Error(`Invalid test version: ${text}`);
  return parsed;
}

describe('compareVersions (shared test vectors)', () => {
  it.each(vectors.compare)('compare(%s, %s) = %i', (a, b, expected) => {
    expect(Math.sign(compareVersions(version(a), version(b)))).toBe(expected);
    expect(Math.sign(compareVersions(version(b), version(a)))).toBe(-expected || 0);
  });
});

describe('satisfies (shared test vectors)', () => {
  it.each(vectors.satisfies)('%s satisfies "%s" = %s', (text, range, expected) => {
    expect(satisfies(version(text), range)).toBe(expected ?? undefined);
  });
});

describe('parseVersion', () => {
  it.each(['v1.0.0', '1.0', '01.0.0', '1.0.0-', '1.0.0-01', ''])('rejects "%s"', (text) => {
    expect(parseVersion(text)).toBeUndefined();
  });
});
