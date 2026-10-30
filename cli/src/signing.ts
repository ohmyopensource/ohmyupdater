// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { ENV_KEY_PASSWORD, ENV_SECRET_KEY, now, UsageError, type Io } from './io.js';
import { DEFAULT_KDF_LIMITS, generateKeyPair, readSecretKey, signMessage } from './keys.js';

export function keygen(args: string[], io: Io): number {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      out: { type: 'string' },
      unencrypted: { type: 'boolean' },
      force: { type: 'boolean' },
    },
  });
  if (values.out === undefined) throw new UsageError('keygen requires --out <name>.');

  const password = io.env[ENV_KEY_PASSWORD];
  if (!values.unencrypted && (password === undefined || password.length === 0)) {
    throw new UsageError(
      `Set ${ENV_KEY_PASSWORD} to encrypt the secret key, or pass --unencrypted for a throwaway key.`,
    );
  }

  const pair = generateKeyPair(
    values.unencrypted ? undefined : password,
    io.kdfLimits ?? DEFAULT_KDF_LIMITS,
  );
  // 'wx' refuses to overwrite an existing key unless --force is given.
  const flag = values.force ? 'w' : 'wx';
  writeFileSync(`${values.out}.pub`, pair.publicKeyFile, { flag });
  writeFileSync(`${values.out}.key`, pair.secretKeyFile, { flag, mode: 0o600 });

  io.out(
    [
      `Key pair generated (key ID ${pair.keyId}).`,
      `  Public key: ${values.out}.pub (embed it in your application)`,
      `  Secret key: ${values.out}.key (store its content as the ${ENV_SECRET_KEY} secret,`,
      '              then delete the file; never commit it)',
    ].join('\n'),
  );
  return 0;
}

export function sign(args: string[], io: Io): number {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      comment: { type: 'string' },
    },
  });
  const [file, ...extra] = positionals;
  if (file === undefined || extra.length > 0) {
    throw new UsageError('sign requires exactly one file.');
  }

  const secretKeyFile = io.env[ENV_SECRET_KEY];
  if (secretKeyFile === undefined || secretKeyFile.length === 0) {
    throw new UsageError(`Set ${ENV_SECRET_KEY} to the content of the secret key file.`);
  }

  const key = readSecretKey(secretKeyFile, io.env[ENV_KEY_PASSWORD] || undefined);
  const timestamp = Math.floor(now(io).getTime() / 1000);
  const comment = values.comment ?? `timestamp:${timestamp}\tfile:${basename(file)}\thashed`;
  const output = values.out ?? `${file}.sig`;

  writeFileSync(output, signMessage(readFileSync(file), key, comment));
  io.out(`Signed ${file} -> ${output}`);
  return 0;
}
