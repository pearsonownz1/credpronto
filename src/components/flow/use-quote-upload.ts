"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackOrderUpload } from "@/lib/analytics/gtag-events";
import { FlowApiError, flowUsesMock, getFlowClient } from "@/lib/flow/client";
import type { UploadChoice } from "@/lib/flow/order-choice";
import { writeEmail, writeToken } from "@/lib/flow/session";
import { rememberUpload } from "@/lib/flow/upload-blobs";
import { clearUploadDraft } from "./upload-draft";
import { useReadingHandoff } from "./reading-handoff";

/** Same upload the translate page runs, then the quote route. */
export function useQuoteUpload() {
  const router = useRouter();
  const mock = flowUsesMock();
  const { beginUpload, setUploadRatio, orderCreated, endHandoff } = useReadingHandoff();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: {
    email: string;
    files: File[];
    choice: UploadChoice;
    pageCount: number | null;
  }) {
    setError(null);
    beginUpload();
    setPending(true);
    try {
      const email = input.email.trim();
      const result = await getFlowClient().upload({
        email,
        files: mock ? [] : input.files,
        choice: input.choice,
        onProgress: setUploadRatio,
      });
      trackOrderUpload(result.orderId, input.pageCount);
      writeToken(result.orderToken);
      writeEmail(email);
      rememberUpload(result.orderToken, input.files);
      clearUploadDraft();
      if (input.choice.orderType === "evaluation") {
        endHandoff();
        router.push(`/checkout?token=${encodeURIComponent(result.orderToken)}`);
        return;
      }
      orderCreated();
      const useOrderRoute =
        !mock ||
        (typeof window !== "undefined" &&
          sessionStorage.getItem("credpronto-mock-order-route") === "1");
      router.push(useOrderRoute ? `/order/${encodeURIComponent(result.orderToken)}` : "/quote");
    } catch (cause) {
      endHandoff();
      const message = cause instanceof FlowApiError ? cause.message : "We couldn't upload those files.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return { mock, pending, error, setError, submit };
}
