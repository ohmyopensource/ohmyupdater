// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { KdfLimits } from './keys.js';

export const ENV_SECRET_KEY = 'OHMYUPDATER_SECRET_KEY';
export const ENV_KEY_PASSWORD = 'OHMYUPDATER_KEY_PASSWORD';

/** Everything the CLI needs from the outside world, injectable for tests. */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** scrypt limits for new secret keys. Only lowered in tests. */
  readonly kdfLimits?: KdfLimits;
  readonly now?: () => Date;
}

/** A mistake in how the command was invoked. Reported without a stack trace. */
export class UsageError extends Error {}

export function now(io: Io): Date {
  return io.now?.() ?? new Date();
}
