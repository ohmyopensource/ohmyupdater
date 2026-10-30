// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from 'vitest';
import { run } from './run.js';

function capture() {
  const lines: string[] = [];
  return { lines, out: (text: string) => lines.push(text) };
}

describe('cli', () => {
  it('prints the supported specification version', async () => {
    const { lines, out } = capture();
    expect(await run(['--version'], out)).toBe(0);
    expect(lines).toEqual(['manifest specification v1']);
  });

  it('prints help and succeeds with --help', async () => {
    const { lines, out } = capture();
    expect(await run(['--help'], out)).toBe(0);
    expect(lines[0]).toContain('Usage: ohmyupdater');
  });

  it('prints help and fails without a command', async () => {
    const { out } = capture();
    expect(await run([], out)).toBe(1);
  });
});
