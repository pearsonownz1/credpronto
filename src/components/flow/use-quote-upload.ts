"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackOrderUpload } from "@/lib/analytics/gtag-events";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import type { UploadChoice } from "@/lib/flow/order-choice";
import { writeToken } from "@/lib/flow/session";
import { rememberUpload } from "@/lib/flow/upload-blobs";
import { clearUploadDraft } from "./upload-draft";
import { useReadingHandoff } from "./reading-handoff";

/** Same upload the translate page runs, then the quote route. */
export function useQuoteUpload() {
  const router = useRouter();
  const mock = flowUsesMock();
  const { beginUpload, setUploadRatio, setUploadFiles, orderCreated, endHandoff } = useReadingHandoff();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(input: {
    files: File[];
    choice: UploadChoice;
    pageCount: number | null;
    signedIn?: boolean;
  }) {
    setError(null);
    beginUpload(input.files.map((file) => ({ name: file.name, ratio: 0 })));
    setPending(true);
    try {
      const result = await getFlowClient().upload({
        files: input.files,
        choice: input.choice,
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
      const reported = cause instanceof Error ? cause.message.trim() : "";
      const message = reported && reported !== "Request failed" ? reported : "We couldn't upload those files.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return { mock, pending, error, setError, submit };
}
