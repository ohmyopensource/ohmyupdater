# OhMyUpdater! Manifest Specification

- **Specification version:** 1 (draft)
- **Status:** Draft. Breaking changes are allowed until OhMyUpdater! `1.0.0`.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Overview

A **publisher** describes the latest release of a **component** (an application, a website, a backend service) in a JSON **manifest**, signs it, and publishes both files at a stable HTTPS URL, typically as GitHub Release assets:

```
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
https://github.com/<owner>/<repo>/releases/latest/download/latest.json.sig
```

A **client** embedded in the component downloads both files, verifies them, and decides whether an update is available. Applying the update is delegated to a platform **adapter** and MUST only happen after an explicit user (or operator) decision.

## 2. Files

| File              | Content                                                    | Maximum size |
| ----------------- | ---------------------------------------------------------- | ------------ |
| `latest.json`     | The manifest, UTF-8 encoded JSON                           | 64 KiB       |
| `latest.json.sig` | A minisign signature over the exact bytes of `latest.json` | 4 KiB        |

The signature covers the raw bytes of the manifest file. Clients MUST NOT re-serialize, normalize or canonicalize the manifest before verifying it.

## 3. Manifest format

The manifest MUST validate against `schema/manifest.v1.schema.json`. Unknown fields are not allowed.

| Field            | Type    | Required | Description                                                                              |
| ---------------- | ------- | -------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion`  | integer | yes      | Version of this specification. MUST be `1`.                                              |
| `component`      | string  | yes      | Component identifier: lowercase letters, digits and single hyphens.                      |
| `version`        | string  | yes      | Released version, [Semantic Versioning 2.0.0](https://semver.org), without a `v` prefix. |
| `publishedAt`    | string  | yes      | Publication time, RFC 3339 in UTC (`Z` suffix).                                          |
| `expiresAt`      | string  | yes      | Expiry time, RFC 3339 in UTC. See section 6.                                             |
| `minimumVersion` | string  | no       | Oldest supported version. Older clients MUST treat the update as required.               |
| `notes`          | string  | no       | Release notes in Markdown. Untrusted content, see section 7.                             |
| `requires`       | array   | no       | Requirements on other components, see section 3.2.                                       |
| `platforms`      | object  | yes      | One entry per supported platform, see section 3.1.                                       |

### 3.1 Platforms and actions

Keys of `platforms` MUST be one of:

`web`, `server`, `android`, `ios`, `windows-x86_64`, `windows-aarch64`, `darwin-x86_64`, `darwin-aarch64`, `linux-x86_64`, `linux-aarch64`.

Each entry declares an `action`:

| Action    | Fields                                | Meaning                                                    |
| --------- | ------------------------------------- | ---------------------------------------------------------- |
| `install` | `url`, `size`, `sha256`, `signature`? | Download an artifact and install it.                       |
| `reload`  | none                                  | Reload the application from its origin (web).              |
| `store`   | `url`                                 | Send the user to an app store page.                        |
| `notify`  | `url`?                                | Inform an operator only; nothing is downloaded (backends). |

- `url` MUST use HTTPS.
- `size` is the exact artifact size in bytes (maximum 2 GiB).
- `sha256` is the lowercase hexadecimal SHA-256 digest of the artifact.
- `signature` is OPTIONAL and exists only for platform updaters that require their own artifact signature (for example the Tauri updater). Integrity of every artifact is already guaranteed by `sha256`, because the manifest itself is signed.

### 3.2 Requirements

Each item of `requires` has a `component` and a `range`. A range is one or more comparators separated by a single space, all of which MUST be satisfied:

```
>=2.1.0
>=2.1.0 <3.0.0
```

Only the operators `>=`, `>`, `<=`, `<` and `=` are allowed. Shorthand syntaxes such as `^`, `~`, `x` or `*` are deliberately not supported, so that every implementation evaluates ranges identically.

Bounds MAY include a prerelease (`>=2.1.0-rc.1`) but MUST NOT include build metadata. Shared test vectors are in `fixtures/versions/cases.json`.

### 3.3 Version comparison

Versions are compared using Semantic Versioning 2.0.0 precedence. Build metadata (`+...`) MUST be ignored when comparing.

## 4. Signatures

Signatures use the [minisign](https://jedisct1.github.io/minisign/) format (Ed25519).

- Verifiers MUST support the prehashed algorithm (`ED`, Ed25519 over a BLAKE2b-512 digest of the file), which is the default in current minisign versions.
- Verifiers MUST reject the legacy non-prehashed algorithm (`Ed`).
- The client is configured with a list of **trusted public keys**. The key ID embedded in the signature MUST match one of them; otherwise verification fails.
- The trusted comment MUST NOT influence any decision, but verifiers MUST verify the global signature that covers it.

### 4.1 Verification order

Verifiers MUST perform these checks in order and report the first failure with the given error code, so that every implementation fails in the same way on the same input:

| Order | Check                                                                      | Error code                 |
| ----- | -------------------------------------------------------------------------- | -------------------------- |
| 1     | The signature file has four lines and valid base64 of the expected lengths | `malformed-signature`      |
| 2     | The algorithm is `ED` (`Ed` is reported separately)                        | `legacy-algorithm`         |
| 3     | The key ID matches a trusted public key                                    | `untrusted-key`            |
| 4     | The signature over the BLAKE2b-512 digest of the file is valid             | `invalid-signature`        |
| 5     | The global signature over the signature and the trusted comment is valid   | `invalid-global-signature` |

Line endings MAY be `\n` or `\r\n`. Shared test vectors are in `fixtures/signatures/cases.json`.

### 4.2 Key rotation

To replace a key, a publisher:

1. releases a version whose clients trust both the old and the new public key, signed with the old key;
2. waits until that version is widely adopted;
3. starts signing with the new key, and later removes the old key from the trusted list.

Private keys MUST only be stored as CI secrets or offline. They MUST NOT be passed as command-line arguments or written to logs.

## 5. Client verification procedure

A client MUST perform these steps in order, stop at the first failure and report it with the given error code:

| Step | Check                                                                                  | Error code                |
| ---- | -------------------------------------------------------------------------------------- | ------------------------- |
| 1    | Download `latest.json` over HTTPS, aborting if it exceeds 64 KiB                       | `manifest-too-large`      |
| 2    | Download `latest.json.sig` over HTTPS, aborting if it exceeds 4 KiB                    | `malformed-signature`     |
| 3    | Verify the signature over the exact downloaded bytes (section 4.1)                     | see section 4.1           |
| 4    | Decode the bytes as UTF-8 and parse them as JSON                                       | `invalid-json`            |
| 4    | Validate the manifest against the schema                                               | `invalid-manifest`        |
| 5    | `component` equals the component the client was configured for                         | `component-mismatch`      |
| 6    | `expiresAt` is later than `publishedAt`                                                | `invalid-validity-period` |
| 6    | `expiresAt` is later than the current time                                             | `expired`                 |
| 7    | `version` is not lower than the highest version previously accepted for this component | `rollback`                |
| 8    | `minimumVersion`, if present, is not greater than `version`                            | `invalid-minimum-version` |

The signature is verified before the manifest is parsed, so that unauthenticated input never reaches the JSON parser. After all checks succeed, the client MUST store `version` as the new highest accepted version for the component.

Download failures (network errors, timeouts, HTTP errors) are reported as `download-failed`, and an invalid client configuration (for example a non-HTTPS URL or no trusted key) as `invalid-configuration`. Clients MAY accept plain HTTP for `localhost`, `127.0.0.1` and `[::1]` during development only.

Any failure results in the `error` status. A failed check MUST NOT prevent the application from running; it only prevents updating. Shared test vectors are in `fixtures/policy/cases.json`.

### 5.1 Status

The status is computed from a verified manifest, the running version, the current platform and, optionally, the known versions of other components. The first matching row applies:

| Status       | Condition                                                                               |
| ------------ | --------------------------------------------------------------------------------------- |
| `error`      | The manifest has no entry for the current platform (error code `unsupported-platform`). |
| `up-to-date` | The running version is equal to or greater than `version`.                              |
| `blocked`    | An entry of `requires` is not satisfied by the known version of that component.         |
| `required`   | The running version is lower than `minimumVersion`.                                     |
| `available`  | Otherwise.                                                                              |

Requirements on components whose version is not known to the client are not evaluated. A client that cannot know the version of a dependency (for example a web application that is not told the backend version) therefore never reports `blocked` for it.

## 6. Freshness

`expiresAt` protects clients from freeze attacks, where an attacker keeps serving an old, validly signed manifest to hide newer releases.

- Publishers SHOULD set `expiresAt` no more than 365 days after `publishedAt`.
- Publishers MUST re-sign and republish the manifest before it expires, even if no new release is made.

## 7. Applying an update

Adapters applying an `install` action MUST:

- download the artifact over HTTPS into a directory not writable by other users;
- abort the download as soon as it exceeds `size`;
- verify `size` and `sha256` on the downloaded file;
- execute exactly the file that was verified, with no opportunity for it to be replaced in between.

Release notes MUST be rendered as Markdown without raw HTML, or as plain text.

## 8. Security considerations

| Threat                                   | Mitigation                                       |
| ---------------------------------------- | ------------------------------------------------ |
| Tampered manifest or compromised hosting | Manifest signature (section 4)                   |
| Tampered artifact                        | `sha256` inside the signed manifest              |
| Manifest of another component replayed   | `component` check (step 5)                       |
| Rollback to an older vulnerable version  | Anti-rollback check (step 7)                     |
| Freeze attack                            | `expiresAt` (section 6)                          |
| Endless or oversized downloads           | Size limits on manifest, signature and artifacts |
| Downgrade to plain HTTP                  | HTTPS-only URLs                                  |
| Injection through release notes          | Notes treated as untrusted Markdown (section 7)  |
| Signing key compromise                   | Multiple trusted keys and rotation (section 4.2) |
