# OhMyUpdater!

> Open source update notifications by **OhMyOpenSource!** - signed manifests, update checks and adapters for web, desktop, mobile and backend.

OhMyUpdater! lets the people who run your software know when you release a new version: in a web app, in a desktop app, in a server log. It only **notifies**. Installing an update is always a decision of the user or operator, never automatic.

It needs no update server. You publish a small signed file with each release, and every installation checks it.

```
 You (publisher)                     Hosting with CORS                 Installations
 ───────────────                     (e.g. GitHub Pages)               ─────────────
 release v2.3.0                                                        web app, desktop app,
   └─ create + sign latest.json ──►  latest.json + latest.json.sig ◄── backend, fork...
      (ohmyupdater CLI, in CI)                                           └─ verify signature
                                                                         └─ "Version 2.3.0 is available"
```

---

## Which package do I need?

Nobody installs every package. Pick the row that describes you:

| You want to...                                   | Use                                                                                                  | How                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Show update notifications in a **web app**       | [`@ohmyopensource/ohmyupdater-web`](https://www.npmjs.com/package/@ohmyopensource/ohmyupdater-web)   | `npm install @ohmyopensource/ohmyupdater-web`            |
| **Publish** releases that others get notified of | [`@ohmyopensource/ohmyupdater-cli`](https://www.npmjs.com/package/@ohmyopensource/ohmyupdater-cli)   | `npx @ohmyopensource/ohmyupdater-cli` in your release CI |
| Build your **own adapter** on the core logic     | [`@ohmyopensource/ohmyupdater-core`](https://www.npmjs.com/package/@ohmyopensource/ohmyupdater-core) | `npm install @ohmyopensource/ohmyupdater-core`           |

`ohmyupdater-web` brings `ohmyupdater-core` with it automatically. The CLI never ends up in your application: it only runs when you publish a release.

All packages are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify that they were built from this repository.

---

## Quick start for publishers

You publish software and want its users (and the people who fork it) to know about new releases.

### 1. Generate a key pair, once

```bash
read -rs OHMYUPDATER_KEY_PASSWORD && export OHMYUPDATER_KEY_PASSWORD   # type a strong password
npx @ohmyopensource/ohmyupdater-cli keygen --out release
```

This creates two files:

- `release.pub`: the **public key**. Embed it in your software. It is not secret.
- `release.key`: the **secret key**, encrypted with your password. Never commit it.

### 2. Store the secrets in your CI

In your repository, go to **Settings → Secrets and variables → Actions** and create:

| Secret                     | Value                             |
| -------------------------- | --------------------------------- |
| `OHMYUPDATER_SECRET_KEY`   | The full content of `release.key` |
| `OHMYUPDATER_KEY_PASSWORD` | The password you chose            |

Then delete `release.key` from your machine, or keep it in a password manager.

### 3. Create, sign and verify the manifest at every release

In your release workflow, after the build:

```yaml
- name: Create and sign the update manifest
  env:
    OHMYUPDATER_SECRET_KEY: ${{ secrets.OHMYUPDATER_SECRET_KEY }}
    OHMYUPDATER_KEY_PASSWORD: ${{ secrets.OHMYUPDATER_KEY_PASSWORD }}
    VERSION: ${{ github.ref_name }}
  run: |
    RELEASE_PAGE="https://github.com/me/my-app/releases/tag/$VERSION"
    npx @ohmyopensource/ohmyupdater-cli@0.2.0 create \
      --component my-app --version "${VERSION#v}" \
      --notify "web=$RELEASE_PAGE" --notify "server=$RELEASE_PAGE" \
      --out latest.json
    npx @ohmyopensource/ohmyupdater-cli@0.2.0 sign latest.json
    npx @ohmyopensource/ohmyupdater-cli@0.2.0 verify latest.json \
      --public-key release.pub --component my-app
```

`create` describes what each platform should do. Combine as many options as you need:

| Option                                                  | Typical use                           | Result for the user                      |
| ------------------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| `--notify <platform>=<release page>`                    | Self-hosted web apps, backends, forks | A notification with a link               |
| `--reload`                                              | A web app that you host yourself      | A notification, then a page reload       |
| `--install <platform>=<file> --base-url <download URL>` | Desktop and Android builds            | A notification, then an optional install |
| `--store <platform>=<store URL>`                        | App store releases                    | A notification, then the store page      |

Platforms are `web`, `server`, `android`, `ios`, `windows-x86_64`, `windows-aarch64`, `darwin-x86_64`, `darwin-aarch64`, `linux-x86_64` and `linux-aarch64`.

Run `npx @ohmyopensource/ohmyupdater-cli --help` for every option, including `--minimum-version` (older versions must update), `--requires` (dependencies between components) and `--expires-in`.

### 4. Publish the two files

Upload `latest.json` and `latest.json.sig` to a stable HTTPS URL that allows CORS, so that browsers can read it. **GitHub Pages** works and is free for public repositories. Release assets do not work for web apps, because GitHub does not send CORS headers for them.

The manifest expires (180 days by default) so that nobody can keep serving an old one to hide new releases. Re-sign and republish it before it expires, even without a new release.

---

## Quick start for web apps

```bash
npm install @ohmyopensource/ohmyupdater-web
```

```ts
import { createWebUpdater } from '@ohmyopensource/ohmyupdater-web';

const updater = createWebUpdater({
  component: 'my-app',
  currentVersion: '2.2.0',
  manifestUrl: 'https://me.github.io/updates/my-app/latest.json',
  trustedKeys: ['RWS...'], // the publisher's public key (release.pub)
});

updater.subscribe(({ result, snoozed }) => {
  if ((result?.status === 'available' || result?.status === 'required') && !snoozed) {
    // Show your banner with result.version and result.notes.
    // "Later" calls updater.snooze() (not possible for required updates).
    // "Update" or "Details" calls updater.apply() after the user clicks.
  }
});

updater.start(); // checks now, every 6 hours and when the tab becomes visible
```

The updater never throws and never breaks your application: network errors, an expired manifest or an invalid signature become `{ status: 'error', code }`.

### Forks and derived projects

`currentVersion` is the version of the **original project** your code is based on. If you fork a project and number your own releases differently, keep the upstream version in a separate constant and update it when you merge upstream changes. Otherwise the comparison with upstream releases loses its meaning.

---

## Security model

- **Every manifest is signed** with Ed25519 ([minisign](https://jedisct1.github.io/minisign/) format). Whoever controls the hosting cannot forge a notification without the publisher's secret key.
- **Every downloadable file is pinned** by size and SHA-256 inside the signed manifest.
- **Old manifests are rejected**: they expire, and clients never accept a version lower than one they have already seen (anti-rollback).
- **A manifest only applies to its component**, so a valid manifest of another project cannot be replayed.
- **Downloads are bounded**: size limits, timeouts, HTTPS only.
- **Nothing is applied automatically.**

The full rules are in the [specification](spec/manifest.md). Every implementation is tested against the same [shared test vectors](spec/fixtures/).

---

## Package status

| Package                            | Platform               | Status  |
| ---------------------------------- | ---------------------- | ------- |
| `@ohmyopensource/ohmyupdater-core` | Any JavaScript runtime | `0.2.0` |
| `@ohmyopensource/ohmyupdater-web`  | Browsers               | `0.2.0` |
| `@ohmyopensource/ohmyupdater-cli`  | Node.js (publishers)   | `0.2.0` |
| Reusable GitHub Action             | GitHub Actions         | Planned |
| Tauri adapter                      | Desktop                | Planned |
| Node.js adapter                    | Backends and CLIs      | Planned |
| Dart package                       | Flutter                | Planned |
| Spring Boot starter                | Java backends          | Planned |

OhMyUpdater! is in early development. Until `1.0.0`, the specification and the APIs may change between minor versions. See the [changelog](CHANGELOG.md).

---

## Repository structure

| Path                 | Content                                                         |
| -------------------- | --------------------------------------------------------------- |
| `spec/`              | The manifest specification, JSON Schema and shared test vectors |
| `packages/js/core/`  | Core: verification, validation, update status, download client  |
| `packages/js/web/`   | Browser adapter                                                 |
| `cli/`               | Command-line tool for publishers                                |
| `scripts/`           | Release and interoperability scripts                            |
| `.github/workflows/` | CI and the release workflow                                     |

## Development

Requirements: Node.js 24 and pnpm (the version is pinned in `package.json`).

```bash
pnpm install
pnpm format:check
pnpm lint:root
pnpm spec:validate
pnpm typecheck
pnpm test
pnpm build
```

For contribution rules, commit conventions, code of conduct and organizational standards, see the [OhMyOpenSource! Guidelines](https://github.com/ohmyopensource/ohmyopensource-guidelines) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

OhMyUpdater! decides what users are told to install, so security issues are taken seriously. **Please do not open public issues for vulnerabilities.** See [SECURITY.md](SECURITY.md) for how to report them privately.

## License

OhMyUpdater! is released under the [Mozilla Public License 2.0](LICENSE).

You are free to use it in any project, open source or proprietary. If you modify OhMyUpdater!'s own source files and distribute them, those modifications must remain available under the MPL-2.0. Copyright and license notices must be preserved.

## Name and trademarks

The MPL-2.0 does not grant rights to use the names, logos or trademarks of OhMyOpenSource! (see section 2.3 of the license). Forks are welcome, but please give them a different name and do not present them as the official OhMyUpdater!.

---

Made with care by [OhMyOpenSource!](https://ohmyopensource.org)
