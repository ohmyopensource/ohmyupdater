// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { SPEC_VERSION } from '@ohmyopensource/ohmyupdater-core';
import {
  DEFAULT_KDF_LIMITS,
  generateKeyPair,
  KeyError,
  readSecretKey,
  signMessage,
  type KdfLimits,
} from './keys.js';

export const ENV_SECRET_KEY = 'OHMYUPDATER_SECRET_KEY';
export const ENV_KEY_PASSWORD = 'OHMYUPDATER_KEY_PASSWORD';

const HELP = `Usage: ohmyupdater <command> [options]

Commands:
  keygen --out <name> [--unencrypted] [--force]
            Generate a key pair: <name>.pub (public) and <name>.key (secret).
            The secret key is encrypted with ${ENV_KEY_PASSWORD}.
  sign <file> [--out <path>] [--comment <text>]
            Sign a file with the secret key in ${ENV_SECRET_KEY}
            (password in ${ENV_KEY_PASSWORD}). Writes <file>.sig by default.
  create    Create a manifest from build artifacts (coming soon)
  verify    Verify a signed manifest (coming soon)

Options:
  -h, --help       Show this help
  -v, --version    Show the supported specification version

Secrets are only read from environment variables, never from arguments.
`;

/** Everything the CLI needs from the outside world, injectable for tests. */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** scrypt limits for new secret keys. Only lowered in tests. */
  readonly kdfLimits?: KdfLimits;
  readonly now?: () => Date;
}

const defaultIo: Io = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  env: process.env,
};

class UsageError extends Error {}

function keygen(args: string[], io: Io): number {
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

function signCommand(args: string[], io: Io): number {
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
  const timestamp = Math.floor((io.now?.() ?? new Date()).getTime() / 1000);
  const comment = values.comment ?? `timestamp:${timestamp}\tfile:${basename(file)}\thashed`;
  const output = values.out ?? `${file}.sig`;

  writeFileSync(output, signMessage(readFileSync(file), key, comment));
  io.out(`Signed ${file} -> ${output}`);
  return 0;
}

/** Runs the CLI with the given arguments and returns the process exit code. */
export async function run(args: string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'keygen':
        return keygen(rest, io);
      case 'sign':
        return signCommand(rest, io);
      case '-v':
      case '--version':
        io.out(`manifest specification v${SPEC_VERSION}`);
        return 0;
      case '-h':
      case '--help':
        io.out(HELP);
        return 0;
      default:
        io.err(HELP);
        return 1;
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof KeyError) {
      io.err(`Error: ${error.message}`);
      return 1;
    }
    if (error instanceof Error && 'code' in error) {
      // parseArgs and file system errors carry a code and a readable message.
      io.err(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
