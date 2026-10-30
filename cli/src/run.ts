// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { SPEC_VERSION } from '@ohmyopensource/ohmyupdater-core';
import { create } from './create.js';
import { ENV_KEY_PASSWORD, ENV_SECRET_KEY, UsageError, type Io } from './io.js';
import { KeyError } from './keys.js';
import { keygen, sign } from './signing.js';
import { verify } from './verify-command.js';

export { ENV_KEY_PASSWORD, ENV_SECRET_KEY, type Io } from './io.js';

const HELP = `Usage: ohmyupdater <command> [options]

Commands:
  keygen --out <name> [--unencrypted] [--force]
      Generate a key pair: <name>.pub (public) and <name>.key (secret).
      The secret key is encrypted with ${ENV_KEY_PASSWORD}.

  create --component <id> --version <version> --out <file> [options]
      Create a manifest. Options:
        --install <platform>=<file>   artifact to install (repeatable)
        --base-url <url>              where --install artifacts are downloaded from
        --store <platform>=<url>      app store page (repeatable)
        --reload                      web application (reload)
        --notify [--notify-url <url>] backend service (notify an operator)
        --minimum-version <version>   older versions must update
        --requires "<component> <range>"  requirement (repeatable)
        --notes-file <file>           release notes in Markdown
        --expires-in <days>           validity, 1 to 365 days (default 180)

  sign <file> [--out <path>] [--comment <text>]
      Sign a file with the secret key in ${ENV_SECRET_KEY}
      (password in ${ENV_KEY_PASSWORD}). Writes <file>.sig by default.

  verify <file> --public-key <file> --component <id> [options]
      Verify a signed manifest like a client would. Options:
        --signature <file>            signature file (default <file>.sig)
        --public-key <file>           repeatable, for key rotation
        --check-file <platform>=<file>  check a local artifact against the manifest

Options:
  -h, --help       Show this help
  -v, --version    Show the supported specification version

Secrets are only read from environment variables, never from arguments.
`;

const defaultIo: Io = {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  env: process.env,
};

/** Runs the CLI with the given arguments and returns the process exit code. */
export async function run(args: string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case 'keygen':
        return keygen(rest, io);
      case 'create':
        return await create(rest, io);
      case 'sign':
        return sign(rest, io);
      case 'verify':
        return await verify(rest, io);
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
      // Core verification errors, parseArgs and file system errors all carry a code.
      io.err(`Error (${String(error.code)}): ${error.message}`);
      return 1;
    }
    if (error instanceof Error) {
      io.err(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
