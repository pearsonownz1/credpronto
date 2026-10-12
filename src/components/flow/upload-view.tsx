"use client";

import { evaluationsLive, parseEvaluationService } from "@/lib/flow/order-choice";
import { FlowHeader } from "./flow-header";
import { UploadCard } from "./upload-card";

export function UploadView({ initialService }: { initialService?: string | null }) {
  const live = evaluationsLive();
  const evaluation = live ? parseEvaluationService(initialService) : null;
  return (
    <div>
      <FlowHeader current="upload" />
      <main className="mx-auto w-full max-w-[560px] px-4 py-10 md:py-16">
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          {evaluation ? "Upload the degree" : "Upload your documents"}
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          {evaluation
            ? "PDF or phone photos. You’ll preview a watermarked report, then pay. Staff sign off before it is released."
            : live
              ? "PDF or phone photos. Choose a translation or an evaluation. We’ll price it before you pay."
              : "PDF or phone photos. We’ll price every page before you pay."}
        </p>
        <UploadCard initialService={initialService} />
      </main>
    </div>
  );
}
