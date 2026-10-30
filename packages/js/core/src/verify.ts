// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The client verification procedure (spec section 5) and the update status
// (spec section 5.1). Both are pure functions: downloading is done elsewhere.

import {
  validateManifest,
  type Manifest,
  type PlatformEntry,
  type PlatformId,
  type Requirement,
} from './manifest.js';
import { verifySignature, type PublicKey } from './minisign.js';
import { compareVersions, parseVersion, satisfies, type Version } from './semver.js';

/** Maximum accepted size of a manifest, in bytes (spec section 2). */
export const MAX_MANIFEST_SIZE = 65536;

export type VerificationErrorCode =
  | 'manifest-too-large'
  | 'invalid-json'
  | 'component-mismatch'
  | 'invalid-validity-period'
  | 'expired'
  | 'rollback'
  | 'invalid-minimum-version'
  | 'unsupported-platform';

/** Raised when a signed manifest fails a policy check of the specification. */
export class VerificationError extends Error {
  readonly code: VerificationErrorCode;

  constructor(code: VerificationErrorCode, message: string) {
    super(message);
    this.name = 'VerificationError';
    this.code = code;
  }
}

export interface VerifyManifestInput {
  /** Exact bytes of the downloaded `latest.json`. */
  readonly manifest: Uint8Array;
  /** Content of the downloaded `latest.json.sig`. */
  readonly signature: string;
  readonly trustedKeys: readonly PublicKey[];
  /** Component this client was configured for. */
  readonly component: string;
  /** Current time. Passed explicitly so that verification is deterministic. */
  readonly now: Date;
  /** Highest version previously accepted for this component, if any (anti-rollback). */
  readonly highestAcceptedVersion?: string;
}

export interface VerifiedManifest {
  readonly manifest: Manifest;
  /** Key ID of the trusted key that signed the manifest. */
  readonly keyId: string;
}

function requireVersion(text: string, name: string): Version {
  const parsed = parseVersion(text);
  if (parsed === undefined) throw new TypeError(`${name} is not a valid version: ${text}`);
  return parsed;
}

/**
 * Runs steps 1 to 8 of the client verification procedure and returns the
 * validated manifest. Throws a {@link VerificationError}, `MinisignError` or
 * `ManifestError` with the code of the first failed check. On success the
 * caller MUST store `manifest.version` as the new highest accepted version.
 */
export function verifyManifest(input: VerifyManifestInput): VerifiedManifest {
  // 1. Size limit (also enforced while downloading).
  if (input.manifest.length > MAX_MANIFEST_SIZE) {
    throw new VerificationError('manifest-too-large', 'Manifest exceeds 64 KiB.');
  }

  // 3. Signature over the exact bytes, before anything is parsed.
  const { keyId } = verifySignature(input.manifest, input.signature, input.trustedKeys);

  // 4. Parse and validate.
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.manifest));
  } catch {
    throw new VerificationError('invalid-json', 'Manifest is not valid UTF-8 JSON.');
  }
  const manifest = validateManifest(parsed);

  // 5. Component binding.
  if (manifest.component !== input.component) {
    throw new VerificationError(
      'component-mismatch',
      `Manifest is for "${manifest.component}", expected "${input.component}".`,
    );
  }

  // 6. Freshness.
  const publishedAt = Date.parse(manifest.publishedAt);
  const expiresAt = Date.parse(manifest.expiresAt);
  if (expiresAt <= publishedAt) {
    throw new VerificationError('invalid-validity-period', 'expiresAt is not after publishedAt.');
  }
  if (expiresAt <= input.now.getTime()) {
    throw new VerificationError('expired', `Manifest expired at ${manifest.expiresAt}.`);
  }

  // 7. Anti-rollback.
  const version = requireVersion(manifest.version, 'Manifest version');
  if (input.highestAcceptedVersion !== undefined) {
    const highest = requireVersion(input.highestAcceptedVersion, 'highestAcceptedVersion');
    if (compareVersions(version, highest) < 0) {
      throw new VerificationError(
        'rollback',
        `Version ${manifest.version} is lower than the previously accepted ${input.highestAcceptedVersion}.`,
      );
    }
  }

  // 8. Consistency of minimumVersion.
  if (
    manifest.minimumVersion !== undefined &&
    compareVersions(requireVersion(manifest.minimumVersion, 'minimumVersion'), version) > 0
  ) {
    throw new VerificationError(
      'invalid-minimum-version',
      'minimumVersion is greater than version.',
    );
  }

  return { manifest, keyId };
}

export interface StatusInput {
  /** Version of the running component. */
  readonly currentVersion: string;
  /** Platform the component is running on. */
  readonly platform: PlatformId;
  /**
   * Known versions of other components, e.g. reported by a backend. Requirements
   * on components that are not listed here are not evaluated.
   */
  readonly installed?: Readonly<Record<string, string>>;
}

export type UpdateStatus =
  | { readonly status: 'up-to-date' }
  | {
      readonly status: 'available' | 'required';
      readonly version: string;
      readonly entry: PlatformEntry;
      readonly notes?: string;
    }
  | {
      readonly status: 'blocked';
      readonly version: string;
      readonly unmet: readonly Requirement[];
    };

/**
 * Computes the update status of a verified manifest (spec section 5.1).
 * Throws a {@link VerificationError} with code `unsupported-platform` when the
 * manifest has no entry for the current platform.
 */
export function computeStatus(manifest: Manifest, input: StatusInput): UpdateStatus {
  const entry = manifest.platforms[input.platform];
  if (entry === undefined) {
    throw new VerificationError(
      'unsupported-platform',
      `No entry for platform "${input.platform}".`,
    );
  }

  const current = requireVersion(input.currentVersion, 'currentVersion');
  const latest = requireVersion(manifest.version, 'Manifest version');
  if (compareVersions(current, latest) >= 0) return { status: 'up-to-date' };

  const installed = input.installed ?? {};
  const unmet = (manifest.requires ?? []).filter((requirement) => {
    if (!Object.hasOwn(installed, requirement.component)) return false;
    const version = parseVersion(installed[requirement.component] ?? '');
    return version === undefined || satisfies(version, requirement.range) !== true;
  });
  if (unmet.length > 0) return { status: 'blocked', version: manifest.version, unmet };

  const required =
    manifest.minimumVersion !== undefined &&
    compareVersions(current, requireVersion(manifest.minimumVersion, 'minimumVersion')) < 0;

  return {
    status: required ? 'required' : 'available',
    version: manifest.version,
    entry,
    ...(manifest.notes === undefined ? {} : { notes: manifest.notes }),
  };
}
