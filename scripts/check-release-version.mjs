// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fails unless every published package, and the CLI version used by the
// action, has the version of the release tag.
// Usage: node scripts/check-release-version.mjs v0.1.0

import { readFileSync } from 'node:fs';

const PACKAGES = ['packages/js/core', 'packages/js/web', 'cli'];

const tag = process.argv[2] ?? '';
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
if (match === null) {
  console.error(`"${tag}" is not a release tag like v1.2.3.`);
  process.exit(1);
}

const expected = match[1];
let failed = false;
for (const dir of PACKAGES) {
  const {
    name,
    version,
    private: isPrivate,
  } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  if (version !== expected || isPrivate === true) {
    console.error(
      `${name}: version ${version}${isPrivate ? ' (private)' : ''}, expected ${expected}.`,
    );
    failed = true;
  } else {
    console.log(`${name}@${version}`);
  }
}

// The action installs the CLI released together with it.
const action = readFileSync('action/action.yml', 'utf8');
const cliVersion = /cli-version:[\s\S]*?default: '([^']*)'/.exec(action)?.[1];
if (cliVersion !== expected) {
  console.error(`action: default cli-version ${cliVersion}, expected ${expected}.`);
  failed = true;
} else {
  console.log(`action: cli-version ${cliVersion}`);
}

if (failed) process.exit(1);
