// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Downloads a manifest and its signature with the limits of the specification
// (section 5, steps 1 and 2), then verifies them and computes the status.
// It never throws: every failure becomes an `error` result, so that a failed
// check can never break the application (spec section 5).

import { PLATFORM_IDS, type PlatformId } from './manifest.js';
import { MAX_SIGNATURE_LENGTH, parsePublicKey, type PublicKey } from './minisign.js';
import { compareVersions, parseVersion } from './semver.js';
import { computeStatus, MAX_MANIFEST_SIZE, verifyManifest, type UpdateStatus } from './verify.js';

/** Minimal key-value storage. `localStorage`, a file or a database can back it. */
export interface UpdaterStorage {
  get(key: string): string | undefined | Promise<string | undefined>;
  set(key: string, value: string): void | Promise<void>;
}

export interface CheckOptions {
  /** Component identifier, as written in the publisher's manifests. */
  readonly component: string;
  /** Version the running software is based on. */
  readonly currentVersion: string;
  readonly platform: PlatformId;
  /** HTTPS URL of `latest.json`. */
  readonly manifestUrl: string;
  /** HTTPS URL of the signature. Defaults to `manifestUrl` + `.sig`. */
  readonly signatureUrl?: string;
  /** The publisher's public keys, as `.pub` file content or bare base64. */
  readonly trustedKeys: readonly string[];
  /** Known versions of other components (spec section 5.1). */
  readonly installed?: Readonly<Record<string, string>>;
  /** Remembers the highest accepted version (anti-rollback). Strongly recommended. */
  readonly storage?: UpdaterStorage;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** Timeout of each download, in milliseconds. Defaults to 15 seconds. */
  readonly timeoutMs?: number;
}

export type CheckErrorCode =
  'invalid-configuration' | 'download-failed' | 'unexpected-error' | (string & {});

export type CheckResult =
  | UpdateStatus
  | { readonly status: 'error'; readonly code: CheckErrorCode; readonly message: string };

const DEFAULT_TIMEOUT = 15_000;

class CheckError extends Error {
  readonly code: CheckErrorCode;

  constructor(code: CheckErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Storage key holding the highest accepted version of a component. */
export function highestVersionKey(component: string): string {
  return `ohmyupdater:${component}:highest-version`;
}

function isLocalhost(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function requireSecureUrl(text: string, name: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new CheckError('invalid-configuration', `${name} is not a valid URL.`);
  }
  // Plain HTTP is only tolerated on the local machine, for development.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost(url))) {
    throw new CheckError('invalid-configuration', `${name} must use HTTPS.`);
  }
  return url.href;
}

/** Downloads `url`, aborting as soon as the body exceeds `limit` bytes. */
async function download(
  url: string,
  limit: number,
  tooLarge: string,
  options: CheckOptions,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      throw new CheckError('download-failed', `Cannot download ${url}: ${String(error)}`);
    }
    if (!response.ok) {
      throw new CheckError('download-failed', `Cannot download ${url}: HTTP ${response.status}.`);
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > limit) throw new CheckError(tooLarge, `${url} exceeds ${limit} bytes.`);

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader === undefined) {
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.length > limit) throw new CheckError(tooLarge, `${url} exceeds ${limit} bytes.`);
      return body;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new CheckError(tooLarge, `${url} exceeds ${limit} bytes.`);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return body;
  } catch (error) {
    if (error instanceof CheckError) throw error;
    throw new CheckError('download-failed', `Cannot download ${url}: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks whether an update is available, following the whole client
 * procedure of the specification. Never throws.
 */
export async function checkForUpdate(options: CheckOptions): Promise<CheckResult> {
  try {
    if (!(PLATFORM_IDS as readonly string[]).includes(options.platform)) {
      throw new CheckError('invalid-configuration', `Unknown platform "${options.platform}".`);
    }
    if (parseVersion(options.currentVersion) === undefined) {
      throw new CheckError('invalid-configuration', 'currentVersion is not a valid version.');
    }
    let trustedKeys: PublicKey[];
    try {
      trustedKeys = options.trustedKeys.map(parsePublicKey);
    } catch {
      throw new CheckError('invalid-configuration', 'A trusted key is not a minisign public key.');
    }
    if (trustedKeys.length === 0) {
      throw new CheckError('invalid-configuration', 'At least one trusted key is required.');
    }
    const manifestUrl = requireSecureUrl(options.manifestUrl, 'manifestUrl');
    const signatureUrl = requireSecureUrl(
      options.signatureUrl ?? `${options.manifestUrl}.sig`,
      'signatureUrl',
    );

    const [manifestBytes, signatureBytes] = await Promise.all([
      download(manifestUrl, MAX_MANIFEST_SIZE, 'manifest-too-large', options),
      download(signatureUrl, MAX_SIGNATURE_LENGTH, 'malformed-signature', options),
    ]);

    let signature: string;
    try {
      signature = new TextDecoder('utf-8', { fatal: true }).decode(signatureBytes);
    } catch {
      throw new CheckError('malformed-signature', 'The signature is not valid UTF-8.');
    }

    const key = highestVersionKey(options.component);
    const stored = await options.storage?.get(key);
    const highest = stored !== undefined && parseVersion(stored) !== undefined ? stored : undefined;

    const { manifest } = verifyManifest({
      manifest: manifestBytes,
      signature,
      trustedKeys,
      component: options.component,
      now: options.now?.() ?? new Date(),
      ...(highest === undefined ? {} : { highestAcceptedVersion: highest }),
    });

    // Spec section 5: remember the accepted version once every check passed.
    const accepted = parseVersion(manifest.version);
    const previous = highest === undefined ? undefined : parseVersion(highest);
    if (
      accepted !== undefined &&
      (previous === undefined || compareVersions(accepted, previous) > 0)
    ) {
      await options.storage?.set(key, manifest.version);
    }

    return computeStatus(manifest, {
      currentVersion: options.currentVersion,
      platform: options.platform,
      ...(options.installed === undefined ? {} : { installed: options.installed }),
    });
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'unexpected-error';
    return {
      status: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
