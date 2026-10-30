// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Validates every fixture in spec/fixtures against the manifest JSON Schema.
// Files in valid/ must pass; files in invalid/ must fail.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const specDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(specDir, 'schema', 'manifest.v1.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

let failures = 0;

for (const [folder, shouldPass] of [
  ['valid', true],
  ['invalid', false],
]) {
  const dir = join(specDir, 'fixtures', folder);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const manifest = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const passed = validate(manifest);

    if (passed === shouldPass) {
      console.log(`ok    ${folder}/${file}`);
    } else {
      failures++;
      console.error(`FAIL  ${folder}/${file} (expected ${shouldPass ? 'valid' : 'invalid'})`);
      if (!passed) console.error(ajv.errorsText(validate.errors, { separator: '\n      ' }));
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) did not match the expected result.`);
  process.exit(1);
}

console.log('\nAll fixtures match the expected result.');
