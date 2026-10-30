// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Browser adapter: checks for updates in the background and tells the UI.
// It only notifies; nothing is applied unless the UI calls apply() after an
// explicit user action.

import {
  checkForUpdate,
  type CheckResult,
  type UpdaterStorage,
} from '@ohmyopensource/ohmyupdater-core';

const HOUR = 60 * 60 * 1000;

export interface WebUpdaterOptions {
  /** Component identifier, as written in the publisher's manifests. */
  readonly component: string;
  /** Version the running application is based on. */
  readonly currentVersion: string;
  /** HTTPS URL of the publisher's `latest.json` (it must allow CORS, as GitHub Pages does). */
  readonly manifestUrl: string;
  /** HTTPS URL of the signature. Defaults to `manifestUrl` + `.sig`. */
  readonly signatureUrl?: string;
  /** The publisher's minisign public keys. */
  readonly trustedKeys: readonly string[];
  /** Known versions of other components, e.g. reported by your backend. */
  readonly installed?: Readonly<Record<string, string>>;
  /** Interval between background checks. Defaults to 6 hours; 0 disables them. */
  readonly checkIntervalMs?: number;
  /** Check again when the tab becomes visible. Defaults to true. */
  readonly checkOnVisible?: boolean;
  /** How long "later" hides an optional update. Defaults to 24 hours. */
  readonly snoozeMs?: number;
  /** Runs before reloading, e.g. to activate a waiting service worker. */
  readonly beforeReload?: () => void | Promise<void>;

  // Injectable for tests. They default to the browser globals.
  readonly fetch?: typeof fetch;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly now?: () => Date;
  readonly document?: VisibilitySource;
  readonly location?: Pick<Location, 'reload'>;
  readonly open?: (url: string) => void;
}

/** The part of `document` the updater uses to detect when the tab becomes visible. */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface UpdaterState {
  /** Result of the last check, or `undefined` before the first one completes. */
  readonly result: CheckResult | undefined;
  /** Whether a check is running. */
  readonly checking: boolean;
  /** Whether the user postponed this optional update. The UI should hide its banner. */
  readonly snoozed: boolean;
}

export interface WebUpdater {
  readonly state: UpdaterState;
  /** Checks now. Concurrent calls share the same check. Never rejects. */
  check(): Promise<CheckResult>;
  /** Starts background checks: one now, then periodically and when the tab becomes visible. */
  start(): void;
  /** Stops background checks. */
  stop(): void;
  /** Calls `listener` on every state change. Returns a function that unsubscribes. */
  subscribe(listener: (state: UpdaterState) => void): () => void;
  /** Hides an optional update for a while. Required updates cannot be postponed. */
  snooze(): void;
  /**
   * Acts on the update after an explicit user action: reloads for `reload`,
   * opens the publisher's page for `notify` and `store`. Does nothing otherwise.
   */
  apply(): Promise<void>;
}

interface SyncStorage extends UpdaterStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

/** Wraps Web Storage so that blocked or full storage never breaks the updater. */
function safeStorage(storage: Pick<Storage, 'getItem' | 'setItem'> | null): SyncStorage {
  return {
    get: (key) => {
      try {
        return storage?.getItem(key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    set: (key, value) => {
      try {
        storage?.setItem(key, value);
      } catch {
        // Without storage the updater still works; it only forgets what it saw.
      }
    },
  };
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createWebUpdater(options: WebUpdaterOptions): WebUpdater {
  const storage = safeStorage(options.storage === undefined ? browserStorage() : options.storage);
  const now = options.now ?? (() => new Date());
  const doc: VisibilitySource | undefined = options.document ?? globalThis.document;
  const snoozeKey = `ohmyupdater:${options.component}:snoozed`;
  const listeners = new Set<(state: UpdaterState) => void>();

  let result: CheckResult | undefined;
  let running: Promise<CheckResult> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  function isSnoozed(): boolean {
    if (result?.status !== 'available') return false;
    const [version, until] = (storage.get(snoozeKey) ?? '').split('@');
    return version === result.version && Number(until) > now().getTime();
  }

  function state(): UpdaterState {
    return { result, checking: running !== undefined, snoozed: isSnoozed() };
  }

  function emit(): void {
    const current = state();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // A faulty listener must not break the others or the updater.
      }
    }
  }

  function onVisible(): void {
    if (doc?.visibilityState === 'visible') void check();
  }

  async function run(): Promise<CheckResult> {
    try {
      result = await checkForUpdate({
        component: options.component,
        currentVersion: options.currentVersion,
        platform: 'web',
        manifestUrl: options.manifestUrl,
        trustedKeys: options.trustedKeys,
        storage,
        now,
        ...(options.signatureUrl === undefined ? {} : { signatureUrl: options.signatureUrl }),
        ...(options.installed === undefined ? {} : { installed: options.installed }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      return result;
    } finally {
      running = undefined;
      emit();
    }
  }

  function check(): Promise<CheckResult> {
    if (running === undefined) {
      running = run();
      emit();
    }
    return running;
  }

  return {
    get state() {
      return state();
    },
    check,
    start() {
      if (timer !== undefined) return;
      void check();
      const interval = options.checkIntervalMs ?? 6 * HOUR;
      if (interval > 0) timer = setInterval(() => void check(), interval);
      if (options.checkOnVisible ?? true) doc?.addEventListener('visibilitychange', onVisible);
    },
    stop() {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      doc?.removeEventListener('visibilitychange', onVisible);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snooze() {
      if (result?.status !== 'available') return;
      const until = now().getTime() + (options.snoozeMs ?? 24 * HOUR);
      storage.set(snoozeKey, `${result.version}@${until}`);
      emit();
    },
    async apply() {
      if (result?.status !== 'available' && result?.status !== 'required') return;
      const { entry } = result;
      if (entry.action === 'reload') {
        await options.beforeReload?.();
        (options.location ?? globalThis.location).reload();
      } else if (
        (entry.action === 'notify' || entry.action === 'store') &&
        entry.url !== undefined
      ) {
        // The URL comes from the signed manifest and is guaranteed to be HTTPS.
        (options.open ?? ((url) => globalThis.open(url, '_blank', 'noopener,noreferrer')))(
          entry.url,
        );
      }
    },
  };
}
