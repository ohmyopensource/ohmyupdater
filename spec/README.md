# OhMyUpdater! Specification

This folder contains the **normative contract** shared by every OhMyUpdater! implementation.

| Path                             | Content                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `manifest.md`                    | The manifest specification (format, signatures, client rules) |
| `schema/manifest.v1.schema.json` | JSON Schema for manifest version 1                            |
| `fixtures/valid/`                | Manifests that MUST pass schema validation                    |
| `fixtures/invalid/`              | Manifests that MUST fail schema validation                    |
| `scripts/validate-fixtures.mjs`  | Checks every fixture against the schema                       |

Run the fixture check from the repository root:

```bash
pnpm spec:validate
```

Every implementation (TypeScript, Dart, Java) MUST produce the same result on every fixture. Signature and policy fixtures (expired manifests, rollback, wrong component, bad signatures) will be added together with the CLI and the test signing keys.
