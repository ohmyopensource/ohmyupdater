# Contributing to OhMyUpdater!

Thank you for your interest in contributing!

## Organizational guidelines

OhMyUpdater! follows the shared standards of the OhMyOpenSource! organization: commit conventions, branching strategy, pull request process, code of conduct and release process. Please read them before contributing:

[OhMyOpenSource! Guidelines](https://github.com/ohmyopensource/ohmyopensource-guidelines)

## Project-specific rules

### Specification first

The manifest specification in `spec/` is the contract shared by every implementation. Any change that affects the manifest format or the verification rules must:

1. update the specification and the JSON Schema;
2. add or update the example manifests (both valid and malicious ones);
3. update every implementation that is affected, or open tracking issues for them.

Pull requests that change behavior without updating the specification will not be merged.

### Security-sensitive changes

Changes touching signature verification, version comparison, download handling or key management require extra care:

- include tests for the failure cases, not only the happy path;
- never weaken a check to make a test pass;
- explain the threat model impact in the pull request description.

Security vulnerabilities must **not** be reported through issues or pull requests. See [SECURITY.md](SECURITY.md).

### Never commit secrets

Private signing keys, tokens and passwords must never be committed, not even for tests. Test fixtures use dedicated test keys that are clearly marked as such and are never used to sign real releases.

## License of contributions

OhMyUpdater! is licensed under the [Mozilla Public License 2.0](LICENSE). By submitting a contribution, you agree that it will be distributed under the same license.

New source files should start with the MPL-2.0 header:

```
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
```

(use the comment syntax of the file's language).
