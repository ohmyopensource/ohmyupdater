// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Structural validation of a parsed manifest (spec section 3). It is the
// hand-written equivalent of spec/schema/manifest.v1.schema.json and is tested
// against the same fixtures. No code is generated at runtime.

import { parseVersion, satisfies } from './semver.js';

export const PLATFORM_IDS = [
  'web',
  'server',
  'android',
  'ios',
  'windows-x86_64',
  'windows-aarch64',
  'darwin-x86_64',
  'darwin-aarch64',
  'linux-x86_64',
  'linux-aarch64',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface InstallEntry {
  readonly action: 'install';
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly signature?: string;
}

export interface ReloadEntry {
  readonly action: 'reload';
}

export interface StoreEntry {
  readonly action: 'store';
  readonly url: string;
}

export interface NotifyEntry {
  readonly action: 'notify';
  readonly url?: string;
}

export type PlatformEntry = InstallEntry | ReloadEntry | StoreEntry | NotifyEntry;

export interface Requirement {
  readonly component: string;
  readonly range: string;
}

export interface Manifest {
  readonly schemaVersion: 1;
  readonly component: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly expiresAt: string;
  readonly minimumVersion?: string;
  readonly notes?: string;
  readonly requires?: readonly Requirement[];
  readonly platforms: Readonly<Partial<Record<PlatformId, PlatformEntry>>>;
}

/** Raised when a manifest does not match the specification. */
export class ManifestError extends Error {
  readonly code = 'invalid-manifest';
  /** JSON path of the offending value, e.g. `/platforms/web/url`. */
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path || '/'}: ${message}`);
    this.name = 'ManifestError';
    this.path = path;
  }
}

const COMPONENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;
const URL_CHARACTERS = /^[\x21-\x7e]+$/;
const MAX_INSTALL_SIZE = 2147483648;

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ManifestError(path, message);
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string, required: string[], optional: string[] = []): Json {
  if (!isObject(value)) fail(path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      fail(`${path}/${key}`, 'is not allowed');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}/${key}`, 'is required');
  }
  return value;
}

function string(value: unknown, path: string, maxLength: number, minLength = 1): string {
  if (typeof value !== 'string') fail(path, 'must be a string');
  // JSON Schema counts Unicode code points, not UTF-16 code units.
  const length = [...value].length;
  if (length < minLength || length > maxLength) {
    fail(path, `must be ${minLength} to ${maxLength} characters long`);
  }
  return value;
}

function componentId(value: unknown, path: string): string {
  const text = string(value, path, 64);
  if (!COMPONENT_ID.test(text)) fail(path, 'must be lowercase letters, digits and single hyphens');
  return text;
}

function version(value: unknown, path: string): string {
  const text = string(value, path, 128);
  if (parseVersion(text) === undefined) fail(path, 'must be a Semantic Versioning 2.0.0 version');
  return text;
}

function timestamp(value: unknown, path: string): string {
  const text = string(value, path, 64);
  const match = TIMESTAMP.exec(text);
  if (match === null) fail(path, 'must be an RFC 3339 timestamp in UTC (Z suffix)');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as number[];
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    fail(path, 'is not a valid date and time');
  }
  return text;
}

function httpsUrl(value: unknown, path: string): string {
  const text = string(value, path, 2048);
  if (!URL_CHARACTERS.test(text)) fail(path, 'must not contain spaces or non-ASCII characters');
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    fail(path, 'must be a valid URL');
  }
  if (!text.startsWith('https://') || parsed.protocol !== 'https:') fail(path, 'must use HTTPS');
  return text;
}

function platformEntry(value: unknown, path: string): PlatformEntry {
  const action = isObject(value) ? value['action'] : undefined;
  switch (action) {
    case 'install': {
      const entry = object(value, path, ['action', 'url', 'size', 'sha256'], ['signature']);
      const size = entry['size'];
      if (
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > MAX_INSTALL_SIZE
      ) {
        fail(`${path}/size`, `must be an integer between 1 and ${MAX_INSTALL_SIZE}`);
      }
      const sha256 = entry['sha256'];
      if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
        fail(`${path}/sha256`, 'must be a lowercase hexadecimal SHA-256 digest');
      }
      const result: InstallEntry = {
        action,
        url: httpsUrl(entry['url'], `${path}/url`),
        size,
        sha256,
      };
      return Object.hasOwn(entry, 'signature')
        ? { ...result, signature: string(entry['signature'], `${path}/signature`, 1024) }
        : result;
    }
    case 'reload':
      object(value, path, ['action']);
      return { action };
    case 'store': {
      const entry = object(value, path, ['action', 'url']);
      return { action, url: httpsUrl(entry['url'], `${path}/url`) };
    }
    case 'notify': {
      const entry = object(value, path, ['action'], ['url']);
      return Object.hasOwn(entry, 'url')
        ? { action, url: httpsUrl(entry['url'], `${path}/url`) }
        : { action };
    }
    default:
      fail(`${path}/action`, 'must be one of install, reload, store, notify');
  }
}

function requirement(value: unknown, path: string): Requirement {
  const entry = object(value, path, ['component', 'range']);
  const component = componentId(entry['component'], `${path}/component`);
  const range = string(entry['range'], `${path}/range`, 128);
  // Any valid version works here: we only check that the range itself parses.
  const probe = parseVersion('0.0.0');
  if (probe === undefined || satisfies(probe, range) === undefined) {
    fail(`${path}/range`, 'must be space-separated comparators using >=, >, <=, < or =');
  }
  return { component, range };
}

/**
 * Validates a parsed manifest and returns a clean copy containing only the
 * fields defined by the specification. Throws a {@link ManifestError} on the
 * first problem found.
 */
export function validateManifest(value: unknown): Manifest {
  const root = object(
    value,
    '',
    ['schemaVersion', 'component', 'version', 'publishedAt', 'expiresAt', 'platforms'],
    ['minimumVersion', 'notes', 'requires'],
  );

  if (root['schemaVersion'] !== 1) fail('/schemaVersion', 'must be 1');

  const platformsValue = object(root['platforms'], '/platforms', [], [...PLATFORM_IDS]);
  const platformKeys = Object.keys(platformsValue) as PlatformId[];
  if (platformKeys.length === 0) fail('/platforms', 'must contain at least one platform');
  const platforms: Partial<Record<PlatformId, PlatformEntry>> = {};
  for (const key of platformKeys) {
    platforms[key] = platformEntry(platformsValue[key], `/platforms/${key}`);
  }

  const manifest: {
    -readonly [K in keyof Manifest]: Manifest[K];
  } = {
    schemaVersion: 1,
    component: componentId(root['component'], '/component'),
    version: version(root['version'], '/version'),
    publishedAt: timestamp(root['publishedAt'], '/publishedAt'),
    expiresAt: timestamp(root['expiresAt'], '/expiresAt'),
    platforms,
  };

  if (Object.hasOwn(root, 'minimumVersion')) {
    manifest.minimumVersion = version(root['minimumVersion'], '/minimumVersion');
  }
  if (Object.hasOwn(root, 'notes')) {
    manifest.notes = string(root['notes'], '/notes', 16384, 0);
  }
  if (Object.hasOwn(root, 'requires')) {
    const requires = root['requires'];
    if (!Array.isArray(requires) || requires.length > 32) {
      fail('/requires', 'must be an array of at most 32 requirements');
    }
    manifest.requires = requires.map((item, index) => requirement(item, `/requires/${index}`));
  }

  return manifest;
}
