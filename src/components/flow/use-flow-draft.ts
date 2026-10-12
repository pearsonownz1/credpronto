"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getFlowClient,
  parseDraft,
  STORAGE_EVENT,
  STORAGE_KEY,
} from "@/lib/flow/client";
import type { FlowDraft } from "@/lib/flow/types";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot() {
  return sessionStorage.getItem(STORAGE_KEY) ?? "";
}

function getServerSnapshot() {
  return "";
}

export function useFlowDraft() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const draft = parseDraft(raw);
  const quote = getFlowClient().price(draft);

  const save = useCallback((patch: Partial<FlowDraft>) => {
    const client = getFlowClient();
    const current = client.load();
    const next: FlowDraft = {
      ...current,
      ...patch,
      details: patch.details
        ? { ...current.details, ...patch.details }
        : current.details,
      files: patch.files ?? current.files,
    };
    client.save(next);
    return next;
  }, []);

  return { draft, quote, save };
}
