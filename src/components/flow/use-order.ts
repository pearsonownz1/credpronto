"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FlowApiError, getFlowClient, flowUsesMock } from "@/lib/flow/client";
import { checkoutOrderRetryDelay } from "@/lib/orders/checkout-return";
import { PREVIEW_POLL_MS, previewPollContinues } from "@/lib/flow/preview-progress";
import { evaluationStatusPollMs } from "@/lib/evalStatus";
import { ORDER_STATUS_POLL_MS, downloadPhase, orderStatusPollDelay } from "@/lib/flow/present";
import {
  QUOTE_POLL_MS,
  QUOTE_REQUEST_TIMEOUT_MS,
  settleQuotePoll,
  type QuotePollOrder,
} from "@/lib/flow/quote-poll";
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
    let seenOrder = false;

    async function load() {
      try {
        const next = await getFlowClient().getOrder(token);
        if (cancelled) return;
        seenOrder = true;
        setSnapshot({ token, order: next, error: null });
        if (mode === "until-download" || mode === "checkout") {
          const phase = downloadPhase(next);
          const delay = evaluationStatusPollMs(next, phase) ?? orderStatusPollDelay(phase);
          if (delay != null) timer = window.setTimeout(load, delay);
        }
      } catch (cause) {
        if (cancelled) return;
        // Checkout success keeps asking until the webhook records the order.
        // A later blip on a page that already has an order keeps that order up.
        if (mode === "checkout" || (mode === "until-download" && seenOrder)) {
          const delay =
            mode === "checkout"
              ? checkoutOrderRetryDelay(Date.now() - startedAt)
              : ORDER_STATUS_POLL_MS;
          timer = window.setTimeout(load, delay);
          return;
        }
        setSnapshot({
          token,
          order: null,
          error: cause instanceof Error ? cause.message : "Could not load this order",
        });
      }
    }

    if (mode === "while-working") {
      // Interval, not a one-shot timeout chained off the first body. A cached
      // or in-flight GET used to leave the quote on that first snapshot.
      let latest: QuotePollOrder | null = null;
      const started = Date.now();
      let quoteStopped = false;
      let quoteRunning = false;
      let abort: AbortController | null = null;

      const stopQuote = () => {
        quoteStopped = true;
        window.clearInterval(timer);
        abort?.abort();
      };

      async function tick() {
        if (cancelled || quoteStopped || quoteRunning) return;
        quoteRunning = true;
        abort = new AbortController();
        const kill = window.setTimeout(() => abort?.abort(), QUOTE_REQUEST_TIMEOUT_MS);
        try {
          const next = await getFlowClient().getOrder(token, { signal: abort.signal });
          if (cancelled || quoteStopped) return;
          latest = next;
          const settled = settleQuotePoll({
            order: next,
            elapsedMs: Date.now() - started,
            error: null,
          });
          if (settled.kind === "error") {
            setSnapshot({ token, order: null, error: settled.message });
            stopQuote();
            return;
          }
          if (settled.kind === "order") {
            setSnapshot({ token, order: next, error: null });
            if (settled.done) stopQuote();
          }
        } catch (cause) {
          if (cancelled || quoteStopped) return;
          const settled = settleQuotePoll({
            order: latest,
            elapsedMs: Date.now() - started,
            error: {
              status: cause instanceof FlowApiError ? cause.status : 0,
              message: cause instanceof Error ? cause.message : "Could not load this order",
            },
          });
          if (settled.kind === "error") {
            setSnapshot({ token, order: null, error: settled.message });
            stopQuote();
          }
        } finally {
          window.clearTimeout(kill);
          quoteRunning = false;
        }
      }

      void tick();
      timer = window.setInterval(() => void tick(), QUOTE_POLL_MS);
      return () => {
        cancelled = true;
        stopQuote();
      };
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
