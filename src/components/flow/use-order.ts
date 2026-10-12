"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FlowApiError, getFlowClient, flowUsesMock } from "@/lib/flow/client";
import { checkoutOrderRetryDelay } from "@/lib/orders/checkout-return";
import { PREVIEW_POLL_MS, previewPollContinues } from "@/lib/flow/preview-progress";
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
  mode: "once" | "while-working" | "until-download" | "until-preview" | "checkout" = "once",
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
    let stopped = false;
    let running = false;
    let queued = false;

    function hidden() {
      return typeof document !== "undefined" && document.visibilityState === "hidden";
    }

    function arm(delay: number) {
      window.clearTimeout(timer);
      if (cancelled || stopped || hidden()) return;
      timer = window.setTimeout(() => void loadPreview(), delay);
    }

    async function loadPreview() {
      window.clearTimeout(timer);
      if (cancelled || stopped || hidden()) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      let order: Awaited<ReturnType<ReturnType<typeof getFlowClient>["getOrder"]>> | null = null;
      let httpStatus: number | null = null;
      try {
        order = await getFlowClient().getOrder(token);
        if (!cancelled) setSnapshot({ token, order, error: null });
      } catch (cause) {
        if (!cancelled) {
          httpStatus = cause instanceof FlowApiError ? cause.status : null;
          const message = cause instanceof Error ? cause.message : "Could not load this order";
          if (!previewPollContinues(null, httpStatus)) {
            stopped = true;
            setSnapshot({ token, order: null, error: message });
          } else {
            setSnapshot((current) => {
              if (current?.token === token && current.order) return current;
              return { token, order: null, error: message };
            });
          }
        }
      } finally {
        running = false;
      }
      if (cancelled || stopped || hidden()) return;
      if (queued) {
        queued = false;
        void loadPreview();
        return;
      }
      if (!previewPollContinues(order, httpStatus)) {
        stopped = true;
        return;
      }
      arm(PREVIEW_POLL_MS);
    }

    function onVisibility() {
      if (hidden()) {
        window.clearTimeout(timer);
        return;
      }
      void loadPreview();
    }

    const startedAt = Date.now();

    async function load() {
      try {
        const next = await getFlowClient().getOrder(token);
        if (cancelled) return;
        setSnapshot({ token, order: next, error: null });
        const keep =
          mode === "until-download" || mode === "checkout"
            ? downloadPhase(next) !== "ready"
            : mode === "while-working" && WORKING.has(next.status);
        if (keep) timer = window.setTimeout(load, 4000);
      } catch (cause) {
        if (cancelled) return;
        if (mode === "checkout") {
          const delay = checkoutOrderRetryDelay(Date.now() - startedAt);
          if (delay != null) {
            timer = window.setTimeout(load, delay);
            return;
          }
        }
        setSnapshot({
          token,
          order: null,
          error: cause instanceof Error ? cause.message : "Could not load this order",
        });
      }
    }

    if (mode === "until-preview") {
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onVisibility);
      void loadPreview();
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onVisibility);
      };
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
