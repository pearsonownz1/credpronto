"use client";

import { useSyncExternalStore } from "react";

export const GCS_UNLOCK_STORAGE_KEY = "gcs_translate_unlocked";

const listeners = new Set<() => void>();
let unlockedOverride: boolean | null = null;

function emitUnlock() {
  for (const listener of listeners) listener();
}

/** Remember or clear the browser unlock and notify the open GCS page. */
export function publishGcsUnlock(unlocked: boolean): void {
  if (unlocked) rememberGcsUnlock();
  else clearStoredGcsUnlock();
  unlockedOverride = unlocked;
  emitUnlock();
}

/**
 * Cookie unlock from the server matches hydration.
 * After that, localStorage / sessionStorage can unlock the page without a refresh.
 */
export function useGcsUnlocked(serverUnlocked: boolean): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (unlockedOverride == null ? serverUnlocked || readStoredGcsUnlock() : unlockedOverride),
    () => serverUnlocked,
  );
}

type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function stores(): KeyValueStore[] {
  if (typeof globalThis === "undefined") return [];
  const found: KeyValueStore[] = [];
  const local = (globalThis as { localStorage?: KeyValueStore }).localStorage;
  const session = (globalThis as { sessionStorage?: KeyValueStore }).sessionStorage;
  if (local) found.push(local);
  if (session) found.push(session);
  return found;
}

export function rememberGcsUnlock(targets = stores()): void {
  for (const store of targets) {
    try {
      store.setItem(GCS_UNLOCK_STORAGE_KEY, "1");
    } catch {
      // Private mode can reject storage. The cookie still unlocks this browser.
    }
  }
}

export function readStoredGcsUnlock(targets = stores()): boolean {
  return targets.some((store) => {
    try {
      return store.getItem(GCS_UNLOCK_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
}

export function clearStoredGcsUnlock(targets = stores()): void {
  for (const store of targets) {
    try {
      store.removeItem(GCS_UNLOCK_STORAGE_KEY);
    } catch {
      // Ignore storage that is blocked.
    }
  }
}
