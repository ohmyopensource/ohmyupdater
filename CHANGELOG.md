# Changelog

All notable changes to the OhMyUpdater! packages are documented here. The packages share one version number. This project follows [Semantic Versioning](https://semver.org); before `1.0.0`, minor versions may contain breaking changes.

## 0.2.0

### Breaking changes

- **cli:** `--notify` now takes a platform and an optional link, and can be repeated: `--notify web=<url>`, `--notify server`. It replaces `--notify` without a value and `--notify-url`, which only supported the `server` platform. Migrate `--notify --notify-url <url>` to `--notify server=<url>`.

### Added

- **cli:** notifications for any platform, including `web` for self-hosted web applications.

## 0.1.0

First release.

- **core:** minisign signature verification, manifest validation, Semantic Versioning, the client verification procedure, update status and a download client with size limits and timeouts.
- **web:** browser adapter with background checks, snoozing and user-triggered actions.
- **cli:** `keygen`, `create`, `sign` and `verify` commands, compatible with the official minisign tool.
