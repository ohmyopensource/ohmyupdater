// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Version of the manifest specification implemented by this package. */
export const SPEC_VERSION = 1;

export {
  MAX_SIGNATURE_LENGTH,
  MinisignError,
  parsePublicKey,
  verifySignature,
  type MinisignErrorCode,
  type PublicKey,
  type VerifiedSignature,
} from './minisign.js';
