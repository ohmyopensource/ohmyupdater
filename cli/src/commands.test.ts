// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENV_SECRET_KEY, run, type Io } from './run.js';

const FAST = { opslimit: 1048576, memlimit: 16777216 };
const BASE_URL = 'https://github.com/ohmyopensource/example-app/releases/download/v1.4.0/';

function io(env: Record<string, string> = {}, date = '2026-11-01T10:00:00Z') {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env,
    kdfLimits: FAST,
    now: () => new Date(date),
  };
  return { out, err, io: value };
}

let dir: string;
let secretKey: string;
let artifact: string;
let manifest: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ohmyupdater-commands-'));
  await run(['keygen', '--out', join(dir, 'release'), '--unencrypted'], io().io);
  secretKey = readFileSync(join(dir, 'release.key'), 'utf8');
  artifact = join(dir, 'Example App_1.4.0_x64-setup.exe');
  writeFileSync(artifact, 'pretend this is an installer');
  manifest = join(dir, 'latest.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function createAndSign(extra: string[] = []) {
  const created = io();
  const code = await run(
    [
      'create',
      '--component',
      'example-app',
      '--version',
      '1.4.0',
      '--install',
      `windows-x86_64=${artifact}`,
      '--base-url',
      BASE_URL,
      '--reload',
      '--out',
      manifest,
      ...extra,
    ],
    created.io,
  );
  expect(code, created.err.join('\n')).toBe(0);
  expect(await run(['sign', manifest], io({ [ENV_SECRET_KEY]: secretKey }).io)).toBe(0);
}

function verifyArgs(...extra: string[]) {
  return [
    'verify',
    manifest,
    '--public-key',
    join(dir, 'release.pub'),
    '--component',
    'example-app',
    ...extra,
  ];
}

describe('create', () => {
  it('writes a manifest with the size and hash of each artifact', async () => {
    await createAndSign(['--expires-in', '30']);
    const written = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    expect(written).toMatchObject({
      schemaVersion: 1,
      component: 'example-app',
      version: '1.4.0',
      publishedAt: '2026-11-01T10:00:00Z',
      expiresAt: '2026-12-01T10:00:00Z',
      platforms: {
        'windows-x86_64': {
          action: 'install',
          url: `${BASE_URL}Example%20App_1.4.0_x64-setup.exe`,
          size: 28,
          sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
        },
        web: { action: 'reload' },
      },
    });
  });

  it('notifies on any platform, with or without a link', async () => {
    const releasePage = 'https://github.com/ohmyopensource/example-app/releases/tag/v1.4.0';
    const t = io();
    const code = await run(
      [
        'create',
        '--component',
        'example-app',
        '--version',
        '1.4.0',
        '--notify',
        `web=${releasePage}`,
        '--notify',
        'server',
        '--out',
        manifest,
      ],
      t.io,
    );
    expect(code, t.err.join('\n')).toBe(0);
    const written = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    expect(written['platforms']).toEqual({
      web: { action: 'notify', url: releasePage },
      server: { action: 'notify' },
    });
  });

  it('never writes a manifest that clients would reject', async () => {
    const t = io();
    const code = await run(
      [
        'create',
        '--component',
        'example-app',
        '--version',
        'v1.4.0',
        '--reload',
        '--out',
        manifest,
      ],
      t.io,
    );
    expect(code).toBe(1);
    expect(t.err[0]).toContain('/version');
  });

  it('validates its own options', async () => {
    const base = ['create', '--component', 'example-app', '--version', '1.0.0', '--out', manifest];
    const cases = [
      [...base, '--install', `windows-x86_64=${artifact}`],
      [...base, '--reload', '--expires-in', '400'],
      [...base, '--install', `windows=${artifact}`, '--base-url', BASE_URL],
      [...base, '--reload', '--store', 'web=https://example.com'],
      [...base, '--reload', '--requires', 'example-api'],
      [...base, '--notify', 'web=http://example.com/insecure'],
      [...base, '--notify', 'desktop'],
    ];
    for (const args of cases) {
      expect(await run(args, io().io), args.join(' ')).toBe(1);
    }
  });
});

describe('verify', () => {
  it('accepts a manifest created and signed by the CLI', async () => {
    await createAndSign();
    const t = io();
    expect(await run(verifyArgs('--check-file', `windows-x86_64=${artifact}`), t.io)).toBe(0);
    expect(t.out[0]).toMatch(/^OK: example-app 1\.4\.0, signed by key [0-9A-F]{16}/);
  });

  it('detects an artifact that does not match the manifest', async () => {
    await createAndSign();
    writeFileSync(artifact, 'a different installer!!!!!!!');
    const t = io();
    expect(await run(verifyArgs('--check-file', `windows-x86_64=${artifact}`), t.io)).toBe(1);
    expect(t.err[0]).toContain('does not match');
  });

  it('detects a manifest modified after signing', async () => {
    await createAndSign();
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('1.4.0', '1.4.1'));
    const t = io();
    expect(await run(verifyArgs(), t.io)).toBe(1);
    expect(t.err[0]).toContain('invalid-signature');
  });

  it('applies the policy checks of the specification', async () => {
    await createAndSign(['--expires-in', '10']);

    const wrongComponent = io();
    const args = verifyArgs();
    args[args.length - 1] = 'other-app';
    expect(await run(args, wrongComponent.io)).toBe(1);
    expect(wrongComponent.err[0]).toContain('component-mismatch');

    const expired = io({}, '2027-01-01T00:00:00Z');
    expect(await run(verifyArgs(), expired.io)).toBe(1);
    expect(expired.err[0]).toContain('expired');

    const soon = io();
    expect(await run(verifyArgs(), soon.io)).toBe(0);
    expect(soon.err[0]).toContain('expires in less than 30 days');
  });

  it('requires a public key and a component', async () => {
    await createAndSign();
    expect(await run(['verify', manifest], io().io)).toBe(1);
  });
});
