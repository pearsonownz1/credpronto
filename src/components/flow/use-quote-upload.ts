"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackOrderUpload } from "@/lib/analytics/gtag-events";
import { flowUsesMock, getFlowClient } from "@/lib/flow/client";
import type { UploadChoice } from "@/lib/flow/order-choice";
import { writeEmail, writeToken } from "@/lib/flow/session";
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
    email: string;
    files: File[];
    choice: UploadChoice;
    pageCount: number | null;
  }) {
    setError(null);
    beginUpload(input.files.map((file) => ({ name: file.name, ratio: 0 })));
    setPending(true);
    try {
      const email = input.email.trim();
      const result = await getFlowClient().upload({
        email,
        files: input.files,
        choice: input.choice,
        onProgress: setUploadRatio,
        onFileProgress: setUploadFiles,
      });
      trackOrderUpload(result.orderId, input.pageCount);
      writeToken(result.orderToken);
      writeEmail(email);
      rememberUpload(result.orderToken, input.files);
      clearUploadDraft();
      const payFirst =
        input.choice.orderType === "evaluation" && input.choice.includeTranslation !== true;
      if (payFirst) {
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
      const reported = cause instanceof Error ? cause.message.trim() : "";
      const message = reported && reported !== "Request failed" ? reported : "We couldn't upload those files.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return { mock, pending, error, setError, submit };
}
