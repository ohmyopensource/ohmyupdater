// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from './index.js';

describe('core', () => {
  it('implements specification version 1', () => {
    expect(SPEC_VERSION).toBe(1);
  });
});
