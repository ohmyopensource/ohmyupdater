// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PLATFORM_IDS,
  validateManifest,
  type PlatformEntry,
  type PlatformId,
} from '@ohmyopensource/ohmyupdater-core';
import { digestFile } from './artifacts.js';
import { now, UsageError, type Io } from './io.js';

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 180;
const MAX_EXPIRY_DAYS = 365;

function platformId(value: string, option: string): PlatformId {
  if (!(PLATFORM_IDS as readonly string[]).includes(value)) {
    throw new UsageError(
      `${option}: unknown platform "${value}" (use one of ${PLATFORM_IDS.join(', ')}).`,
    );
  }
  return value as PlatformId;
}

function splitPair(value: string, option: string): [PlatformId, string] {
  const index = value.indexOf('=');
  if (index <= 0 || index === value.length - 1) {
    throw new UsageError(`${option} expects <platform>=<value>, got "${value}".`);
  }
  return [platformId(value.slice(0, index), option), value.slice(index + 1)];
}

/** RFC 3339 in UTC, without milliseconds. */
function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export async function create(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      component: { type: 'string' },
      version: { type: 'string' },
      'minimum-version': { type: 'string' },
      'notes-file': { type: 'string' },
      'expires-in': { type: 'string' },
      requires: { type: 'string', multiple: true },
      install: { type: 'string', multiple: true },
      'base-url': { type: 'string' },
      store: { type: 'string', multiple: true },
      reload: { type: 'boolean' },
      notify: { type: 'boolean' },
      'notify-url': { type: 'string' },
      out: { type: 'string' },
    },
  });

  if (values.component === undefined || values.version === undefined || values.out === undefined) {
    throw new UsageError('create requires --component, --version and --out.');
  }

  const expiryDays = Number(values['expires-in'] ?? DEFAULT_EXPIRY_DAYS);
  if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > MAX_EXPIRY_DAYS) {
    throw new UsageError(`--expires-in must be a number of days between 1 and ${MAX_EXPIRY_DAYS}.`);
  }

  const platforms: Partial<Record<PlatformId, PlatformEntry>> = {};
  const add = (platform: PlatformId, entry: PlatformEntry) => {
    if (platforms[platform] !== undefined) {
      throw new UsageError(`Platform "${platform}" is declared more than once.`);
    }
    platforms[platform] = entry;
  };

  const installs = values.install ?? [];
  if (installs.length > 0 && values['base-url'] === undefined) {
    throw new UsageError(
      '--install requires --base-url, the URL the artifacts are downloaded from.',
    );
  }
  // A trailing slash makes the artifact name resolve inside the base URL.
  const baseUrl = values['base-url']?.endsWith('/') ? values['base-url'] : `${values['base-url']}/`;
  for (const value of installs) {
    const [platform, file] = splitPair(value, '--install');
    const { size, sha256 } = await digestFile(file);
    const url = new URL(encodeURIComponent(basename(file)), baseUrl).href;
    add(platform, { action: 'install', url, size, sha256 });
  }
  for (const value of values.store ?? []) {
    const [platform, url] = splitPair(value, '--store');
    add(platform, { action: 'store', url });
  }
  if (values.reload) add('web', { action: 'reload' });
  if (values.notify || values['notify-url'] !== undefined) {
    add(
      'server',
      values['notify-url'] === undefined
        ? { action: 'notify' }
        : { action: 'notify', url: values['notify-url'] },
    );
  }

  const requires = (values.requires ?? []).map((value) => {
    const index = value.indexOf(' ');
    if (index <= 0) {
      throw new UsageError(`--requires expects "<component> <range>", got "${value}".`);
    }
    return { component: value.slice(0, index), range: value.slice(index + 1) };
  });

  const published = now(io);
  const draft = {
    schemaVersion: 1,
    component: values.component,
    version: values.version,
    publishedAt: timestamp(published),
    expiresAt: timestamp(new Date(published.getTime() + expiryDays * DAY)),
    ...(values['minimum-version'] === undefined
      ? {}
      : { minimumVersion: values['minimum-version'] }),
    ...(values['notes-file'] === undefined
      ? {}
      : { notes: readFileSync(values['notes-file'], 'utf8') }),
    ...(requires.length === 0 ? {} : { requires }),
    platforms,
  };

  // The core validator guarantees that create never writes a manifest clients would reject.
  const manifest = validateManifest(draft);
  writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
  io.out(
    `Created ${values.out} (${manifest.component} ${manifest.version}, expires ${manifest.expiresAt})`,
  );
  return 0;
}
