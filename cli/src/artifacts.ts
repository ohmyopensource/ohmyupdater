// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';

/** Maximum artifact size allowed by the specification (2 GiB). */
export const MAX_ARTIFACT_SIZE = 2147483648;

export interface ArtifactDigest {
  readonly size: number;
  readonly sha256: string;
}

/** Computes size and SHA-256 of a file by streaming it, so large builds fit in memory. */
export async function digestFile(path: string): Promise<ArtifactDigest> {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${path} is not a file.`);
  if (stat.size < 1 || stat.size > MAX_ARTIFACT_SIZE) {
    throw new Error(`${path} must be between 1 byte and 2 GiB.`);
  }

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { size: stat.size, sha256: hash.digest('hex') };
}
