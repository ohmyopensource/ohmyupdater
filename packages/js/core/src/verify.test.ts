// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlatformId } from './manifest.js';
import { validateManifest } from './manifest.js';
import { parsePublicKey } from './minisign.js';
import { computeStatus, MAX_MANIFEST_SIZE, verifyManifest } from './verify.js';

interface VerificationCase {
  name: string;
  manifest: string;
  signature: string;
  trustedKeys: string[];
  component: string;
  now: string;
  highestAcceptedVersion?: string;
  expected: { valid: true; version: string } | { valid: false; error: string };
}

interface StatusCase {
  name: string;
  manifest: unknown;
  currentVersion: string;
  platform: PlatformId;
  installed?: Record<string, string>;
  expected: { status: string; unmet?: string[]; error?: string };
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../../spec/fixtures/policy/cases.json', import.meta.url), 'utf8'),
) as { verification: VerificationCase[]; status: StatusCase[] };

describe('verifyManifest (shared test vectors)', () => {
  it.each(vectors.verification.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const verify = () =>
      verifyManifest({
        manifest: new TextEncoder().encode(testCase.manifest),
        signature: testCase.signature,
        trustedKeys: testCase.trustedKeys.map(parsePublicKey),
        component: testCase.component,
        now: new Date(testCase.now),
        ...(testCase.highestAcceptedVersion === undefined
          ? {}
          : { highestAcceptedVersion: testCase.highestAcceptedVersion }),
      });

    if (testCase.expected.valid) {
      expect(verify().manifest.version).toBe(testCase.expected.version);
    } else {
      expect(verify).toThrow(expect.objectContaining({ code: testCase.expected.error }));
    }
  });

  it('rejects oversized manifests before checking the signature', () => {
    const testCase = vectors.verification[0];
    if (testCase === undefined) throw new Error('Missing test vector');
    expect(() =>
      verifyManifest({
        manifest: new Uint8Array(MAX_MANIFEST_SIZE + 1),
        signature: 'not checked',
        trustedKeys: testCase.trustedKeys.map(parsePublicKey),
        component: testCase.component,
        now: new Date(testCase.now),
      }),
    ).toThrow(expect.objectContaining({ code: 'manifest-too-large' }));
  });
});

describe('computeStatus (shared test vectors)', () => {
  it.each(vectors.status.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const manifest = validateManifest(testCase.manifest);
    const compute = () =>
      computeStatus(manifest, {
        currentVersion: testCase.currentVersion,
        platform: testCase.platform,
        ...(testCase.installed === undefined ? {} : { installed: testCase.installed }),
      });

    if (testCase.expected.status === 'error') {
      expect(compute).toThrow(expect.objectContaining({ code: testCase.expected.error }));
      return;
    }

    const result = compute();
    expect(result.status).toBe(testCase.expected.status);
    if (result.status === 'blocked') {
      expect(result.unmet.map((requirement) => requirement.component)).toEqual(
        testCase.expected.unmet,
      );
    }
  });
});
