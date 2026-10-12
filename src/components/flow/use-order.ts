"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getFlowClient, flowUsesMock } from "@/lib/flow/client";
import { downloadPhase } from "@/lib/flow/present";
import {
  EMAIL_KEY,
  MOCK_TOKEN,
  ORDER_EVENT,
  TOKEN_KEY,
  readEmail,
  readToken,
} from "@/lib/flow/session";
import type { CustomerOrder } from "@/lib/orders/view";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(ORDER_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(ORDER_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function tokenSnapshot() {
  return sessionStorage.getItem(TOKEN_KEY) ?? "";
}

function emailSnapshot() {
  return sessionStorage.getItem(EMAIL_KEY) ?? "";
}

export function useStoredToken(pathToken?: string | null) {
  const stored = useSyncExternalStore(subscribe, tokenSnapshot, () => "");
  if (pathToken) return pathToken;
  if (stored) return stored;
  return flowUsesMock() ? MOCK_TOKEN : "";
}

export function useStoredEmail() {
  const stored = useSyncExternalStore(subscribe, emailSnapshot, () => "");
  if (stored) return stored;
  return flowUsesMock() ? "maria.ruiz@email.com" : "";
}

const WORKING = new Set(["draft", "confirmed", "processing", "correction_requested"]);

export function useCustomerOrder(
  token: string,
  mode: "once" | "while-working" | "until-download" = "once",
) {
  const [snapshot, setSnapshot] = useState<{
    token: string;
    order: CustomerOrder | null;
    error: string | null;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let timer = 0;

    async function load() {
      try {
        const next = await getFlowClient().getOrder(token);
        if (cancelled) return;
        setSnapshot({ token, order: next, error: null });
        const keep =
          mode === "until-download"
            ? downloadPhase(next) !== "ready"
            : mode === "while-working" && WORKING.has(next.status);
        if (keep) timer = window.setTimeout(load, 4000);
      } catch (cause) {
        if (cancelled) return;
        setSnapshot({
          token,
          order: null,
          error: cause instanceof Error ? cause.message : "Could not load this order",
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, mode, reloadKey]);

  if (!token) return { order: null, error: null, loading: false, reload };
  const current = snapshot?.token === token ? snapshot : null;
  return {
    order: current?.order ?? null,
    error: current?.error ?? null,
    loading: current == null,
    reload,
  };
}

export function rememberSession(token: string, email?: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(TOKEN_KEY, token);
  if (email) sessionStorage.setItem(EMAIL_KEY, email);
  window.dispatchEvent(new Event(ORDER_EVENT));
}

export { readEmail, readToken };
