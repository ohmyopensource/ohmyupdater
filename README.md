# OhMyUpdater!

> Open source update framework by **OhMyOpenSource!** - signed manifests, update checks and adapters for web, desktop, mobile and backend.

> [!WARNING]
> OhMyUpdater! is in early development (pre-`0.1`). The manifest specification and APIs may change without notice. Do not use it in production yet.

---

## What is this?

OhMyUpdater! lets any application know when a new version is available and, only when the user decides to, apply it, using nothing but a static, signed manifest published with your GitHub Releases. No update server required.

It is built around three ideas:

- **One contract** - a single, versioned manifest format shared by every platform.
- **Security first** - both the manifest and every downloadable artifact are signed (Ed25519) and verified before anything is applied.
- **Platform adapters** - the core only decides *whether* an update is available; small adapters decide *how* to apply it (reload a web app, install a desktop build, open an app store, notify a backend operator).

## Planned packages

| Package | Ecosystem | Status |
|---|---|---|
| Specification (`spec/`) | Language-agnostic | Planned |
| CLI (key generation, manifest signing) | Node.js | Planned |
| Core + web and Tauri adapters | TypeScript / npm | Planned |
| Core + Flutter adapters | Dart / pub.dev | Planned |
| Core + Spring Boot starter | Java / Maven Central | Planned |
| Reusable GitHub Action | GitHub Actions | Planned |

## Documentation

Documentation lives in this repository under `docs/` (coming soon) rather than in a separate `-docs` repository: the manifest specification is part of the contract enforced by the code, so the two must evolve together in the same pull requests.

## Guidelines

For contribution rules, commit conventions, code of conduct and organizational standards, refer to the **OhMyOpenSource! Guidelines** repository:

[OhMyOpenSource! Guidelines](https://github.com/ohmyopensource/ohmyopensource-guidelines)

## Security

OhMyUpdater! delivers code to end users, so security issues are taken seriously. **Please do not open public issues for vulnerabilities.** See [SECURITY.md](SECURITY.md) for how to report them privately.

## License

OhMyUpdater! is released under the [Mozilla Public License 2.0](LICENSE).

You are free to use it in any project, open source or proprietary. If you modify OhMyUpdater!'s own source files and distribute them, those modifications must remain available under the MPL-2.0. Copyright and license notices must be preserved.

## Name and trademarks

The MPL-2.0 does not grant rights to use the names, logos or trademarks of OhMyOpenSource! (see section 2.3 of the license). Forks are welcome, but please give them a different name and do not present them as the official OhMyUpdater!.

---

Made with care by [OhMyOpenSource!](https://ohmyopensource.org)
