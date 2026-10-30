# @ohmyopensource/ohmyupdater-core

Core of [OhMyUpdater!](https://github.com/ohmyopensource/ohmyupdater): manifest validation, minisign signature verification, anti-rollback and update status. It runs in browsers, Node.js and desktop webviews, with no runtime code generation.

Most applications use a platform adapter instead, such as [`@ohmyopensource/ohmyupdater-web`](https://www.npmjs.com/package/@ohmyopensource/ohmyupdater-web).

```ts
import { checkForUpdate } from '@ohmyopensource/ohmyupdater-core';

const result = await checkForUpdate({
  component: 'my-app',
  currentVersion: '1.0.0',
  platform: 'web',
  manifestUrl: 'https://example.github.io/updates/my-app/latest.json',
  trustedKeys: ['RWS...'],
});
```

`checkForUpdate` never throws: failures are returned as `{ status: 'error', code }`.

See the [specification](https://github.com/ohmyopensource/ohmyupdater/blob/main/spec/manifest.md) for the manifest format and the security model.

## License

[MPL-2.0](https://github.com/ohmyopensource/ohmyupdater/blob/main/LICENSE)
