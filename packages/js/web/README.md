# @ohmyopensource/ohmyupdater-web

Browser adapter of [OhMyUpdater!](https://github.com/ohmyopensource/ohmyupdater). It checks a signed manifest in the background and tells your UI when a new version is available. Nothing is applied without an explicit user action.

```ts
import { createWebUpdater } from '@ohmyopensource/ohmyupdater-web';

const updater = createWebUpdater({
  component: 'my-app',
  currentVersion: '1.0.0',
  manifestUrl: 'https://example.github.io/updates/my-app/latest.json',
  trustedKeys: ['RWS...'],
});

updater.subscribe(({ result, snoozed }) => {
  // Show a banner when result?.status is 'available' or 'required' and snoozed is false.
  // "Later" calls updater.snooze(); "Update" calls updater.apply().
});
updater.start();
```

The manifest must be served with CORS enabled, as GitHub Pages does for public sites.

## License

[MPL-2.0](https://github.com/ohmyopensource/ohmyupdater/blob/main/LICENSE)
