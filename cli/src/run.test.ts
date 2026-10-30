// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePublicKey, verifySignature } from '@ohmyopensource/ohmyupdater-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_KEY_PASSWORD, ENV_SECRET_KEY, run, type Io } from './run.js';

const FAST = { opslimit: 1048576, memlimit: 16777216 };

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env,
    kdfLimits: FAST,
    now: () => new Date('2026-11-01T10:00:00Z'),
  };
  return { out, err, io: value };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ohmyupdater-cli-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('general', () => {
  it('prints the supported specification version', async () => {
    const t = io();
    expect(await run(['--version'], t.io)).toBe(0);
    expect(t.out).toEqual(['manifest specification v1']);
  });

  it('prints help and fails without a command', async () => {
    const t = io();
    expect(await run([], t.io)).toBe(1);
    expect(t.err[0]).toContain('Usage: ohmyupdater');
  });
});

describe('keygen', () => {
  it('writes an encrypted key pair', async () => {
    const t = io({ [ENV_KEY_PASSWORD]: 'secret' });
    const base = join(dir, 'release');
    expect(await run(['keygen', '--out', base], t.io)).toBe(0);
    expect(readFileSync(`${base}.key`, 'utf8')).toContain('encrypted secret key');
    expect(() => parsePublicKey(readFileSync(`${base}.pub`, 'utf8'))).not.toThrow();
    if (process.platform !== 'win32') {
      expect(statSync(`${base}.key`).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses to run without a password unless --unencrypted is given', async () => {
    const t = io();
    expect(await run(['keygen', '--out', join(dir, 'k')], t.io)).toBe(1);
    expect(t.err[0]).toContain(ENV_KEY_PASSWORD);
    expect(await run(['keygen', '--out', join(dir, 'k'), '--unencrypted'], t.io)).toBe(0);
  });

  it('never overwrites an existing key without --force', async () => {
    const t = io({ [ENV_KEY_PASSWORD]: 'secret' });
    const base = join(dir, 'release');
    expect(await run(['keygen', '--out', base], t.io)).toBe(0);
    const original = readFileSync(`${base}.key`, 'utf8');
    expect(await run(['keygen', '--out', base], t.io)).toBe(1);
    expect(readFileSync(`${base}.key`, 'utf8')).toBe(original);
    expect(await run(['keygen', '--out', base, '--force'], t.io)).toBe(0);
    expect(readFileSync(`${base}.key`, 'utf8')).not.toBe(original);
  });

  it('rejects unknown options', async () => {
    const t = io({ [ENV_KEY_PASSWORD]: 'secret' });
    expect(await run(['keygen', '--out', join(dir, 'k'), '--password', 'x'], t.io)).toBe(1);
  });
});

describe('sign', () => {
  async function keyPair(password: string) {
    const base = join(dir, 'release');
    await run(['keygen', '--out', base], io({ [ENV_KEY_PASSWORD]: password }).io);
    return {
      secretKey: readFileSync(`${base}.key`, 'utf8'),
      publicKey: parsePublicKey(readFileSync(`${base}.pub`, 'utf8')),
    };
  }

  it('signs a file with the key from the environment', async () => {
    const { secretKey, publicKey } = await keyPair('secret');
    const file = join(dir, 'latest.json');
    writeFileSync(file, '{"schemaVersion":1}\n');

    const t = io({ [ENV_SECRET_KEY]: secretKey, [ENV_KEY_PASSWORD]: 'secret' });
    expect(await run(['sign', file], t.io)).toBe(0);

    const result = verifySignature(readFileSync(file), readFileSync(`${file}.sig`, 'utf8'), [
      publicKey,
    ]);
    expect(result.trustedComment).toBe('timestamp:1793527200\tfile:latest.json\thashed');
  });

  it('fails without the secret key or with a wrong password', async () => {
    const { secretKey } = await keyPair('secret');
    const file = join(dir, 'latest.json');
    writeFileSync(file, '{}');

    const missing = io({ [ENV_KEY_PASSWORD]: 'secret' });
    expect(await run(['sign', file], missing.io)).toBe(1);
    expect(missing.err[0]).toContain(ENV_SECRET_KEY);

    const wrong = io({ [ENV_SECRET_KEY]: secretKey, [ENV_KEY_PASSWORD]: 'wrong' });
    expect(await run(['sign', file], wrong.io)).toBe(1);
    expect(wrong.err[0]).toContain('Wrong password');
  });

  it('requires exactly one file', async () => {
    const t = io();
    expect(await run(['sign'], t.io)).toBe(1);
    expect(await run(['sign', 'a', 'b'], t.io)).toBe(1);
  });
});
