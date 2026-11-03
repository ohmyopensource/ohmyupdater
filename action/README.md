# OhMyUpdater! GitHub Action

Creates, signs and verifies an [OhMyUpdater!](../README.md) update manifest in a release workflow. It runs the `create`, `sign` and `verify` commands of [`@ohmyopensource/ohmyupdater-cli`](../cli/README.md) and outputs the paths of `latest.json` and `latest.json.sig`.

The action does **not** publish the files. Publishing is a separate step, so the step that holds your signing key never holds a token that can write elsewhere, and you can host the manifest wherever you want (see [Publish the two files](../README.md#4-publish-the-two-files)).

## Usage

```yaml
- name: Set up Node.js
  uses: actions/setup-node@<sha> # Node.js 22 or later is required

- name: Create and sign the update manifest
  id: manifest
  uses: ohmyopensource/ohmyupdater/action@<sha> # pin a full commit SHA
  env:
    OHMYUPDATER_SECRET_KEY: ${{ secrets.OHMYUPDATER_SECRET_KEY }}
    OHMYUPDATER_KEY_PASSWORD: ${{ secrets.OHMYUPDATER_KEY_PASSWORD }}
  with:
    component: my-app
    version: ${{ github.ref_name }}
    public-key: ${{ vars.OHMYUPDATER_PUBLIC_KEY }}
    notify: |
      web=https://github.com/me/my-app/releases/tag/${{ github.ref_name }}
      server=https://github.com/me/my-app/releases/tag/${{ github.ref_name }}

- name: Publish the manifest
  env:
    MANIFEST: ${{ steps.manifest.outputs.manifest }}
    SIGNATURE: ${{ steps.manifest.outputs.signature }}
  run: |
    # Copy "$MANIFEST" and "$SIGNATURE" to your GitHub Pages site or another HTTPS host.
```

Store the content of `release.pub` as the `OHMYUPDATER_PUBLIC_KEY` variable: it is public. Store the content of `release.key` and its password as secrets. Generate the key pair once with `npx @ohmyopensource/ohmyupdater-cli keygen --out release`.

## Inputs

Multiline inputs take one value per line. Empty lines and lines starting with `#` are ignored.

| Input             | Required | Description                                                                     |
| ----------------- | -------- | ------------------------------------------------------------------------------- |
| `component`       | Yes      | Component ID, for example `my-app`.                                             |
| `version`         | Yes      | Released version. A leading `v` is removed, so `github.ref_name` works.         |
| `public-key`      | Yes      | Content of the public key file. The signed manifest is verified against it.     |
| `notify`          | No       | `<platform>` or `<platform>=<https-url>`, one per line. A notification only.    |
| `install`         | No       | `<platform>=<file>`, one per line. Size and SHA-256 are computed from the file. |
| `base-url`        | No       | HTTPS URL the `install` files are downloaded from. Required with `install`.     |
| `store`           | No       | `<platform>=<https-url>` of the store page, one per line.                       |
| `reload`          | No       | `true` for a web application served by you. Default `false`.                    |
| `minimum-version` | No       | Versions below this one are told that the update is required.                   |
| `requires`        | No       | `<component> <range>`, one per line, for example `my-api >=2.0.0`.              |
| `notes-file`      | No       | Path to release notes in Markdown.                                              |
| `expires-in`      | No       | Days until the manifest expires, 1 to 365. Default 180.                         |
| `output-dir`      | No       | Where to write the files. Default `$RUNNER_TEMP/ohmyupdater`.                   |
| `cli-version`     | No       | Exact CLI version to use. Defaults to the version released with this action.    |

Platforms are `web`, `server`, `android`, `ios`, `windows-x86_64`, `windows-aarch64`, `darwin-x86_64`, `darwin-aarch64`, `linux-x86_64` and `linux-aarch64`. Each platform can appear only once.

## Environment variables

| Variable                   | Required | Description                                        |
| -------------------------- | -------- | -------------------------------------------------- |
| `OHMYUPDATER_SECRET_KEY`   | Yes      | Content of the secret key file, from a secret.     |
| `OHMYUPDATER_KEY_PASSWORD` | No       | Password of the secret key, from a secret, if any. |

The secret key is never an input, so it never appears in the step's parameters.

## Outputs

| Output      | Description                  |
| ----------- | ---------------------------- |
| `manifest`  | Path of the signed manifest. |
| `signature` | Path of `latest.json.sig`.   |

## Security

- Pin the action to a full commit SHA, like any third-party action.
- The CLI is installed from npm at an exact version, and `npm audit signatures` checks its registry signatures and provenance.
- Inputs are passed to the CLI as separate arguments through environment variables. They are never evaluated as shell code.
- The manifest is verified against `public-key` right after signing, and installable files are checked against their size and hash. If anything fails, the step fails and no files are left behind.
- A step summary shows the signed manifest, so every release leaves a readable record.
