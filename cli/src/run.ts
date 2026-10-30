// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { parseArgs } from 'node:util';
import { SPEC_VERSION } from '@ohmyopensource/ohmyupdater-core';

const HELP = `Usage: ohmyupdater <command> [options]

Commands (coming soon):
  keygen    Generate a signing key pair
  create    Create a manifest from build artifacts
  sign      Sign a manifest
  verify    Verify a signed manifest

Options:
  -h, --help       Show this help
  -v, --version    Show the supported specification version
`;

/** Runs the CLI with the given arguments and returns the process exit code. */
export async function run(
  args: string[],
  out: (text: string) => void = console.log,
): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    out(`manifest specification v${SPEC_VERSION}`);
    return 0;
  }

  out(HELP);
  return values.help ? 0 : 1;
}
