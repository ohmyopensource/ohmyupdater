// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// minisign-compatible key generation, secret key encryption and signing.
// This code only runs on the publisher's machine or CI, never in applications.

import { blake2b } from '@noble/hashes/blake2.js';
import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign,
  timingSafeEqual,
} from 'node:crypto';

const ALG_ED25519 = Buffer.from('Ed');
const ALG_PREHASHED = Buffer.from('ED');
const KDF_SCRYPT = Buffer.from('Sc');
const KDF_NONE = Buffer.alloc(2);
const CHK_BLAKE2B = Buffer.from('B2');

/** minisign defaults (libsodium "sensitive" limits): about 1 GiB of memory. */
export const DEFAULT_KDF_LIMITS = { opslimit: 33554432, memlimit: 1073741824 } as const;

export interface KdfLimits {
  readonly opslimit: number;
  readonly memlimit: number;
}

export interface SecretKey {
  readonly keyId: Buffer;
  /** libsodium format: 32-byte seed followed by the 32-byte public key. */
  readonly secretKey: Buffer;
}

export interface GeneratedKeyPair {
  readonly keyId: string;
  readonly publicKeyFile: string;
  readonly secretKeyFile: string;
}

/** Raised when a secret key cannot be read or decrypted. */
export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyError';
  }
}

function formatKeyId(keyId: Buffer): string {
  return Buffer.from(keyId).reverse().toString('hex').toUpperCase();
}

/** BLAKE2b-256 (crypto_generichash), used by minisign for the secret key checksum. */
function blake2b256(...parts: Buffer[]): Buffer {
  return Buffer.from(blake2b(Buffer.concat(parts), { dkLen: 32 }));
}

/**
 * Converts libsodium scrypt limits to scrypt parameters, exactly like
 * libsodium's pickparams() used by crypto_pwhash_scryptsalsa208sha256.
 */
function scryptParameters({ opslimit, memlimit }: KdfLimits): { N: number; r: number; p: number } {
  const ops = Math.max(opslimit, 32768);
  const r = 8;
  let nLog2 = 1;
  let p: number;
  if (ops < memlimit / 32) {
    p = 1;
    const maxN = Math.floor(ops / (r * 4));
    while (nLog2 < 63 && 2 ** nLog2 <= maxN / 2) nLog2++;
  } else {
    const maxN = Math.floor(memlimit / (r * 128));
    while (nLog2 < 63 && 2 ** nLog2 <= maxN / 2) nLog2++;
    const maxRp = Math.min(Math.floor(ops / 4 / 2 ** nLog2), 0x3fffffff);
    p = Math.floor(maxRp / r);
  }
  return { N: 2 ** nLog2, r, p };
}

function keystream(password: string, salt: Buffer, limits: KdfLimits, length: number): Buffer {
  const { N, r, p } = scryptParameters(limits);
  return scryptSync(password.normalize('NFC'), salt, length, {
    N,
    r,
    p,
    maxmem: 128 * N * r + 1024 * 1024 * 64,
  });
}

function xor(data: Buffer, stream: Buffer): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] ?? 0) ^ (stream[i] ?? 0);
  return out;
}

/**
 * Generates a minisign key pair. The secret key is encrypted with `password`;
 * pass `undefined` only for throwaway keys (it produces an unencrypted key).
 */
export function generateKeyPair(
  password: string | undefined,
  limits: KdfLimits = DEFAULT_KDF_LIMITS,
): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d ?? '', 'base64url');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x ?? '', 'base64url');
  const keyId = randomBytes(8);
  const secretKey = Buffer.concat([seed, pub]);

  const checksum = blake2b256(ALG_ED25519, keyId, secretKey);
  const keynumSk = Buffer.concat([keyId, secretKey, checksum]);
  const salt = randomBytes(32);
  const opslimit = Buffer.alloc(8);
  const memlimit = Buffer.alloc(8);
  opslimit.writeBigUInt64LE(BigInt(limits.opslimit));
  memlimit.writeBigUInt64LE(BigInt(limits.memlimit));

  const encrypted =
    password === undefined
      ? keynumSk
      : xor(keynumSk, keystream(password, salt, limits, keynumSk.length));

  const secretBytes = Buffer.concat([
    ALG_ED25519,
    password === undefined ? KDF_NONE : KDF_SCRYPT,
    CHK_BLAKE2B,
    salt,
    opslimit,
    memlimit,
    encrypted,
  ]);
  const publicBytes = Buffer.concat([ALG_ED25519, keyId, pub]);
  const id = formatKeyId(keyId);

  return {
    keyId: id,
    publicKeyFile: `untrusted comment: minisign public key ${id}\n${publicBytes.toString('base64')}\n`,
    secretKeyFile: `untrusted comment: minisign ${password === undefined ? '' : 'encrypted '}secret key\n${secretBytes.toString('base64')}\n`,
  };
}

/** Reads (and decrypts, if needed) a minisign secret key file. */
export function readSecretKey(text: string, password: string | undefined): SecretKey {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  const encoded =
    lines.length === 2 && lines[0]?.startsWith('untrusted comment:') ? lines[1] : undefined;
  const bytes = encoded === undefined ? Buffer.alloc(0) : Buffer.from(encoded, 'base64');
  if (
    bytes.length !== 158 ||
    !bytes.subarray(0, 2).equals(ALG_ED25519) ||
    !bytes.subarray(4, 6).equals(CHK_BLAKE2B)
  ) {
    throw new KeyError('Not a minisign secret key.');
  }

  const kdf = bytes.subarray(2, 4);
  const salt = bytes.subarray(6, 38);
  const limits = {
    opslimit: Number(bytes.readBigUInt64LE(38)),
    memlimit: Number(bytes.readBigUInt64LE(46)),
  };
  let keynumSk: Buffer = bytes.subarray(54, 158);

  if (kdf.equals(KDF_SCRYPT)) {
    if (password === undefined) {
      throw new KeyError('The secret key is encrypted: a password is required.');
    }
    keynumSk = xor(keynumSk, keystream(password, salt, limits, keynumSk.length));
  } else if (!kdf.equals(KDF_NONE)) {
    throw new KeyError('Unsupported key derivation function.');
  }

  const keyId = keynumSk.subarray(0, 8);
  const secretKey = keynumSk.subarray(8, 72);
  const checksum = keynumSk.subarray(72, 104);
  if (!timingSafeEqual(checksum, blake2b256(ALG_ED25519, keyId, secretKey))) {
    throw new KeyError('Wrong password or corrupted secret key.');
  }
  return { keyId: Buffer.from(keyId), secretKey: Buffer.from(secretKey) };
}

function signRaw(message: Buffer, secretKey: Buffer): Buffer {
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: secretKey.subarray(0, 32).toString('base64url'),
      x: secretKey.subarray(32, 64).toString('base64url'),
    },
  });
  return sign(null, message, key);
}

/** Produces a minisign signature file (prehashed `ED` algorithm) for `message`. */
export function signMessage(message: Uint8Array, key: SecretKey, trustedComment: string): string {
  if (/[\r\n]/.test(trustedComment)) {
    throw new KeyError('The trusted comment must be a single line.');
  }
  const digest = Buffer.from(blake2b(message));
  const signature = signRaw(digest, key.secretKey);
  const globalSignature = signRaw(
    Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]),
    key.secretKey,
  );
  const signatureBytes = Buffer.concat([ALG_PREHASHED, key.keyId, signature]);

  return [
    'untrusted comment: signature from ohmyupdater secret key',
    signatureBytes.toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
    '',
  ].join('\n');
}
