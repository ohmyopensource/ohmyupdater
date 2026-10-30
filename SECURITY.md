# Security Policy

OhMyUpdater! is software that decides what code gets installed on end users' devices. A vulnerability here can affect every application that depends on it, so we treat security reports as our highest priority.

## Supported versions

| Version                    | Supported |
| -------------------------- | --------- |
| Latest pre-release (`0.x`) | Yes       |
| Older pre-releases         | No        |

Until `1.0.0`, only the latest published version receives security fixes.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for security problems.**

Report vulnerabilities privately through GitHub:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected package(s) and version(s), and steps to reproduce.

Please include, when possible:

- the affected component (specification, CLI, a specific core or adapter, GitHub Action);
- a proof of concept or a minimal manifest that triggers the issue;
- the impact you expect (e.g. signature bypass, downgrade, arbitrary download).

## What to expect

- We aim to acknowledge reports within **7 days**.
- We will keep you informed while we investigate and prepare a fix.
- Once a fix is released, we will publish a GitHub Security Advisory and credit you, unless you prefer to remain anonymous.

## Scope

Particularly relevant classes of issues include:

- bypassing manifest or artifact signature verification;
- forcing a downgrade (rollback) or hiding available updates (freeze);
- causing an adapter to download or execute an unintended file;
- unbounded downloads or resource exhaustion;
- injection through release notes or other manifest fields;
- leakage of signing keys through the CLI or GitHub Action.

## Signing keys

If you believe an OhMyUpdater! signing key, or a key used by a project relying on OhMyUpdater!, has been compromised, report it immediately using the private channel above.
