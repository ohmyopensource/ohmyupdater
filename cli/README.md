# @ohmyopensource/ohmyupdater-cli

Command-line tool of [OhMyUpdater!](https://github.com/ohmyopensource/ohmyupdater) for publishers: it generates minisign-compatible keys and creates, signs and verifies update manifests, usually in a release workflow.

```bash
# Once: generate a key pair (the secret key is encrypted with this password).
OHMYUPDATER_KEY_PASSWORD=... npx @ohmyopensource/ohmyupdater-cli keygen --out release

# At every release:
npx @ohmyopensource/ohmyupdater-cli create --component my-app --version 1.4.0 \
  --notify web=https://github.com/me/my-app/releases/tag/v1.4.0 \
  --out latest.json
npx @ohmyopensource/ohmyupdater-cli sign latest.json
npx @ohmyopensource/ohmyupdater-cli verify latest.json --public-key release.pub --component my-app
```

Secrets are read only from the `OHMYUPDATER_SECRET_KEY` and `OHMYUPDATER_KEY_PASSWORD` environment variables. Run `npx @ohmyopensource/ohmyupdater-cli --help` for all options.

## License

[MPL-2.0](https://github.com/ohmyopensource/ohmyupdater/blob/main/LICENSE)
