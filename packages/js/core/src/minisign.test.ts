// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MinisignError, parsePublicKey, verifySignature } from './minisign.js';

interface SignatureCase {
  name: string;
  message: string;
  trustedKeys: string[];
  signature: string;
  expected:
    { valid: true; keyId: string; trustedComment: string } | { valid: false; error: string };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../../spec/fixtures/signatures/cases.json', import.meta.url), 'utf8'),
) as { cases: SignatureCase[] };

describe('verifySignature (shared test vectors)', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const message = new TextEncoder().encode(testCase.message);
    const keys = testCase.trustedKeys.map(parsePublicKey);
    const verify = () => verifySignature(message, testCase.signature, keys);

    if (testCase.expected.valid) {
      expect(verify()).toEqual({
        keyId: testCase.expected.keyId,
        trustedComment: testCase.expected.trustedComment,
      });
    } else {
      expect(verify).toThrow(MinisignError);
      expect(verify).toThrow(expect.objectContaining({ code: testCase.expected.error }));
    }
  });
});

describe('parsePublicKey', () => {
  it('rejects input that is not a minisign public key', () => {
    expect(() => parsePublicKey('not a key')).toThrow(MinisignError);
    expect(() => parsePublicKey('')).toThrow(MinisignError);
  });
});

describe('verifySignature limits', () => {
  it('rejects oversized signature files before parsing', () => {
    const key = parsePublicKey(vectors.cases[0]?.trustedKeys[0] ?? '');
    expect(() => verifySignature(new Uint8Array(), 'x'.repeat(5000), [key])).toThrow(
      expect.objectContaining({ code: 'malformed-signature' }),
    );
  });
});
