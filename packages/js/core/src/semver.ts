// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Semantic Versioning 2.0.0 parsing, comparison and the restricted range
// syntax of the specification (section 3.2 and 3.3).

/** Official Semantic Versioning 2.0.0 pattern, without a `v` prefix. */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const MAX_VERSION_LENGTH = 128;
const COMPARATOR = /^(>=|<=|>|<|=)(.+)$/;

/** A parsed version. Numeric parts are kept as strings to avoid precision loss. */
export interface Version {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
}

/** Parses a version, returning `undefined` if it is not valid Semantic Versioning. */
export function parseVersion(text: string): Version | undefined {
  if (text.length > MAX_VERSION_LENGTH) return undefined;
  const match = SEMVER_PATTERN.exec(text);
  if (match === null) return undefined;
  const [, major = '', minor = '', patch = '', prerelease] = match;
  return { major, minor, patch, prerelease: prerelease === undefined ? [] : prerelease.split('.') };
}

const NUMERIC = /^\d+$/;

/** Compares two non-negative integers written in decimal without leading zeros. */
function compareNumbers(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return compareNumbers(a, b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Compares two versions by Semantic Versioning precedence. Build metadata is
 * ignored. Returns a negative number, zero or a positive number.
 */
export function compareVersions(a: Version, b: Version): number {
  const core =
    compareNumbers(a.major, b.major) ||
    compareNumbers(a.minor, b.minor) ||
    compareNumbers(a.patch, b.patch);
  if (core !== 0) return core;

  // A version without prerelease has higher precedence than one with it.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const result = compareIdentifiers(left, right);
    if (result !== 0) return result;
  }
  return 0;
}

/**
 * Checks whether `version` satisfies `range`: one or more comparators
 * (`>=`, `>`, `<=`, `<`, `=`) separated by a single space, all of which must
 * hold. Returns `undefined` if the range is not valid.
 */
export function satisfies(version: Version, range: string): boolean | undefined {
  if (range.length === 0 || range.length > MAX_VERSION_LENGTH) return undefined;

  let result = true;
  for (const part of range.split(' ')) {
    const match = COMPARATOR.exec(part);
    // Range bounds may carry a prerelease but never build metadata.
    const bound = match?.[2]?.includes('+') === false ? parseVersion(match[2]) : undefined;
    if (match === null || bound === undefined) return undefined;
    const comparison = compareVersions(version, bound);
    switch (match[1]) {
      case '>=':
        result &&= comparison >= 0;
        break;
      case '>':
        result &&= comparison > 0;
        break;
      case '<=':
        result &&= comparison <= 0;
        break;
      case '<':
        result &&= comparison < 0;
        break;
      default:
        result &&= comparison === 0;
    }
  }
  return result;
}
