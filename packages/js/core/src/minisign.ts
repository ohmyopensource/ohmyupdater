// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Verification of minisign signatures (https://jedisct1.github.io/minisign/).
// This module only verifies: signing never happens inside an application.

import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';

/** Maximum accepted size of a signature file, in characters (spec section 2). */
export const MAX_SIGNATURE_LENGTH = 4096;

export type MinisignErrorCode =
  | 'malformed-public-key'
  | 'malformed-signature'
  | 'legacy-algorithm'
  | 'untrusted-key'
  | 'invalid-signature'
  | 'invalid-global-signature';

/** Raised when a public key or a signature cannot be parsed or verified. */
export class MinisignError extends Error {
  readonly code: MinisignErrorCode;

  constructor(code: MinisignErrorCode, message: string) {
    super(message);
    this.name = 'MinisignError';
    this.code = code;
  }
}

/** A trusted Ed25519 public key in minisign format. */
export interface PublicKey {
  /** Key ID as printed by minisign (16 uppercase hexadecimal characters). */
  readonly keyId: string;
  readonly keyIdBytes: Uint8Array;
  readonly key: Uint8Array;
}

/** The result of a successful verification. */
export interface VerifiedSignature {
  /** Key ID of the trusted key that produced the signature. */
  readonly keyId: string;
  /** Signed trusted comment. It MUST NOT be used for any decision (spec section 4). */
  readonly trustedComment: string;
}

const ALG_ED25519 = 'Ed';
const ALG_PREHASHED = 'ED';
const UNTRUSTED_PREFIX = 'untrusted comment:';
const TRUSTED_PREFIX = 'trusted comment: ';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(value: string, code: MinisignErrorCode): Uint8Array {
  if (value.length % 4 !== 0 || !BASE64.test(value)) {
    throw new MinisignError(code, 'Invalid base64 encoding.');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function algorithmOf(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
}

/** Formats a key ID like minisign does: the 8 bytes read as a little-endian integer. */
function formatKeyId(bytes: Uint8Array): string {
  return Array.from(bytes)
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/\r$/, ''));
}

/**
 * Parses a minisign public key. Accepts either the content of a `.pub` file
 * (comment line followed by the key) or the bare base64 key.
 */
export function parsePublicKey(text: string): PublicKey {
  const content = lines(text.trim()).filter((line) => line.length > 0);
  const encoded =
    content.length === 2 && content[0]?.startsWith(UNTRUSTED_PREFIX)
      ? content[1]
      : content.length === 1
        ? content[0]
        : undefined;

  if (encoded === undefined) {
    throw new MinisignError('malformed-public-key', 'Unexpected public key format.');
  }

  const bytes = decodeBase64(encoded, 'malformed-public-key');
  if (bytes.length !== 42 || algorithmOf(bytes) !== ALG_ED25519) {
    throw new MinisignError('malformed-public-key', 'Not an Ed25519 minisign public key.');
  }

  const keyIdBytes = bytes.slice(2, 10);
  return { keyId: formatKeyId(keyIdBytes), keyIdBytes, key: bytes.slice(10, 42) };
}

/**
 * Verifies a minisign signature over `message` using one of the `trustedKeys`.
 * Checks are performed in the order defined by the specification, and the
 * first failure is reported through a {@link MinisignError}.
 */
export function verifySignature(
  message: Uint8Array,
  signatureText: string,
  trustedKeys: readonly PublicKey[],
): VerifiedSignature {
  // 1. Parse the signature file.
  if (signatureText.length > MAX_SIGNATURE_LENGTH) {
    throw new MinisignError('malformed-signature', 'Signature file is too large.');
  }
  const content = lines(signatureText);
  while (content.length > 4 && content[content.length - 1] === '') content.pop();

  const [untrusted, encodedSignature, trusted, encodedGlobal] = content;
  if (
    content.length !== 4 ||
    untrusted === undefined ||
    encodedSignature === undefined ||
    trusted === undefined ||
    encodedGlobal === undefined ||
    !untrusted.startsWith(UNTRUSTED_PREFIX) ||
    !trusted.startsWith(TRUSTED_PREFIX)
  ) {
    throw new MinisignError('malformed-signature', 'Unexpected signature file format.');
  }

  const signatureBytes = decodeBase64(encodedSignature, 'malformed-signature');
  const globalSignature = decodeBase64(encodedGlobal, 'malformed-signature');
  if (signatureBytes.length !== 74 || globalSignature.length !== 64) {
    throw new MinisignError('malformed-signature', 'Unexpected signature length.');
  }

  // 2. Only the prehashed algorithm is accepted.
  const algorithm = algorithmOf(signatureBytes);
  if (algorithm === ALG_ED25519) {
    throw new MinisignError(
      'legacy-algorithm',
      'Legacy (non-prehashed) signatures are not accepted.',
    );
  }
  if (algorithm !== ALG_PREHASHED) {
    throw new MinisignError('malformed-signature', 'Unknown signature algorithm.');
  }

  // 3. The key ID must match a trusted key.
  const keyIdBytes = signatureBytes.slice(2, 10);
  const publicKey = trustedKeys.find((key) => sameBytes(key.keyIdBytes, keyIdBytes));
  if (publicKey === undefined) {
    throw new MinisignError(
      'untrusted-key',
      `Signed by an untrusted key (${formatKeyId(keyIdBytes)}).`,
    );
  }

  // 4. The signature must cover the BLAKE2b-512 digest of the exact message bytes.
  const signature = signatureBytes.slice(10, 74);
  if (!ed25519.verify(signature, blake2b(message), publicKey.key, { zip215: false })) {
    throw new MinisignError('invalid-signature', 'Signature verification failed.');
  }

  // 5. The global signature must cover the signature and the trusted comment.
  const trustedComment = trusted.slice(TRUSTED_PREFIX.length);
  const commentBytes = new TextEncoder().encode(trustedComment);
  const globalMessage = new Uint8Array(signature.length + commentBytes.length);
  globalMessage.set(signature, 0);
  globalMessage.set(commentBytes, signature.length);
  if (!ed25519.verify(globalSignature, globalMessage, publicKey.key, { zip215: false })) {
    throw new MinisignError(
      'invalid-global-signature',
      'Trusted comment signature verification failed.',
    );
  }

  return { keyId: publicKey.keyId, trustedComment };
}
