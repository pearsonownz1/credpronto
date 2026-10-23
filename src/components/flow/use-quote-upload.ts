"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackOrderUpload } from "@/lib/analytics/gtag-events";
import { FlowApiError, flowUsesMock, getFlowClient } from "@/lib/flow/client";
import type { UploadChoice } from "@/lib/flow/order-choice";
import { writeToken } from "@/lib/flow/session";
import { rememberUpload } from "@/lib/flow/upload-blobs";
import { clearUploadDraft } from "./upload-draft";
import { useReadingHandoff } from "./reading-handoff";

export const ALREADY_ORDERED_MESSAGE = "You've already started an order from this PreVal.";

export const ALREADY_ORDERED_HREF = "/dashboard/orders";

/** The message shown when order create rejects a PreVal that already has an order. */
export function quoteUploadFailure(cause: unknown): { message: string; href: string | null } {
  if (cause instanceof FlowApiError && cause.status === 409 && cause.code === "already_ordered") {
    return { message: ALREADY_ORDERED_MESSAGE, href: ALREADY_ORDERED_HREF };
  }
  const reported = cause instanceof Error ? cause.message.trim() : "";
  return {
    message: reported && reported !== "Request failed" ? reported : "We couldn't upload those files.",
    href: null,
  };
}

/** Same upload the translate page runs, then the quote route. */
export function useQuoteUpload() {
  const router = useRouter();
  const mock = flowUsesMock();
  const { beginUpload, setUploadRatio, setUploadFiles, orderCreated, endHandoff } = useReadingHandoff();
  const [pending, setPending] = useState(false);
  const [error, setErrorMessage] = useState<string | null>(null);
  const [errorHref, setErrorHref] = useState<string | null>(null);

  function setError(message: string | null) {
    setErrorHref(null);
    setErrorMessage(message);
  }

  async function submit(input: {
    files: File[];
    choice: UploadChoice;
    pageCount: number | null;
    signedIn?: boolean;
    preEvaluationId?: string | null;
    carriedName?: string | null;
  }) {
    setError(null);
    const started =
      input.files.length > 0
        ? input.files.map((file) => ({ name: file.name, ratio: 0 }))
        : input.carriedName
          ? [{ name: input.carriedName, ratio: 0 }]
          : [];
    beginUpload(started);
    setPending(true);
    try {
      const result = await getFlowClient().upload({
        files: input.files,
        choice: input.choice,
        preEvaluationId: input.preEvaluationId,
        onProgress: setUploadRatio,
        onFileProgress: setUploadFiles,
      });
      trackOrderUpload(result.orderId, input.pageCount);
      writeToken(result.orderToken);
      rememberUpload(result.orderToken, input.files);
      clearUploadDraft();
      const payFirst =
        input.choice.orderType === "evaluation" && input.choice.includeTranslation !== true;
      const useOrderRoute =
        !mock ||
        (typeof window !== "undefined" &&
          sessionStorage.getItem("credpronto-mock-order-route") === "1");
      const nextPath = payFirst
        ? `/checkout?token=${encodeURIComponent(result.orderToken)}`
        : useOrderRoute
          ? `/order/${encodeURIComponent(result.orderToken)}`
          : "/quote";
      if (!input.signedIn) {
        endHandoff();
        const params = new URLSearchParams({ next: nextPath });
        router.push(`/sign-up?${params.toString()}`);
        return;
      }
      if (payFirst) {
        endHandoff();
        router.push(nextPath);
        return;
      }
      orderCreated();
      router.push(nextPath);
    } catch (cause) {
      endHandoff();
      const failure = quoteUploadFailure(cause);
      setErrorMessage(failure.message);
      setErrorHref(failure.href);
    } finally {
      setPending(false);
    }
  }

  return { mock, pending, error, errorHref, setError, submit };
}
