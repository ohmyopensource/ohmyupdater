// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parsePublicKey, verifyManifest, type PlatformId } from '@ohmyopensource/ohmyupdater-core';
import { digestFile } from './artifacts.js';
import { now, UsageError, type Io } from './io.js';

const WARN_BEFORE_EXPIRY = 30 * 24 * 60 * 60 * 1000;

export async function verify(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      'public-key': { type: 'string', multiple: true },
      component: { type: 'string' },
      signature: { type: 'string' },
      'check-file': { type: 'string', multiple: true },
    },
  });
  const [file, ...extra] = positionals;
  if (file === undefined || extra.length > 0) {
    throw new UsageError('verify requires exactly one manifest file.');
  }
  const keyFiles = values['public-key'] ?? [];
  if (keyFiles.length === 0 || values.component === undefined) {
    throw new UsageError('verify requires --public-key <file> and --component <id>.');
  }

  const current = now(io);
  const { manifest, keyId } = verifyManifest({
    manifest: readFileSync(file),
    signature: readFileSync(values.signature ?? `${file}.sig`, 'utf8'),
    trustedKeys: keyFiles.map((path) => parsePublicKey(readFileSync(path, 'utf8'))),
    component: values.component,
    now: current,
  });

  // Optionally check that local build artifacts match the signed size and hash.
  for (const value of values['check-file'] ?? []) {
    const index = value.indexOf('=');
    const platform = value.slice(0, index) as PlatformId;
    const entry = index > 0 ? manifest.platforms[platform] : undefined;
    if (entry?.action !== 'install') {
      throw new UsageError(`--check-file: no install entry for "${value.slice(0, index)}".`);
    }
    const digest = await digestFile(value.slice(index + 1));
    if (digest.size !== entry.size || digest.sha256 !== entry.sha256) {
      io.err(`Error: ${value.slice(index + 1)} does not match the manifest entry for ${platform}.`);
      return 1;
    }
  }

  io.out(
    `OK: ${manifest.component} ${manifest.version}, signed by key ${keyId}, expires ${manifest.expiresAt}`,
  );
  if (Date.parse(manifest.expiresAt) - current.getTime() < WARN_BEFORE_EXPIRY) {
    io.err('Warning: the manifest expires in less than 30 days. Re-sign and republish it.');
  }
  return 0;
}
