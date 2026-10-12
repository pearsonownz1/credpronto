"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { parseEvaluationService } from "@/lib/flow/order-choice";
import { FlowHeader } from "./flow-header";
import { UploadCard } from "./upload-card";

/** Shown while the upload route resolves. It has no email field, so the form is not duplicated. */
export function UploadPageFallback() {
  return (
    <div>
      <FlowHeader current="upload" />
      <main className="mx-auto w-full max-w-[560px] px-4 py-10 md:py-16">
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">Upload your documents</h1>
        <p className="mt-2 text-[15px] text-ink-muted">Loading the upload form…</p>
      </main>
    </div>
  );
}

type UploadSeedValue = { service: string | null; email: string | null };

const UploadSeedContext = createContext<(seed: UploadSeedValue) => void>(() => {});

/** Reports the URL service and signed-in email without remounting the form. */
export function UploadSeed({
  initialService,
  sessionEmail,
}: {
  initialService?: string | null;
  sessionEmail?: string | null;
}) {
  const report = useContext(UploadSeedContext);
  useEffect(() => {
    report({ service: initialService ?? null, email: sessionEmail ?? null });
  }, [report, initialService, sessionEmail]);
  return null;
}

/**
 * The form stays mounted across `?service=` changes. The seed resolves inside
 * Suspense, so that wait can no longer replace the inputs the customer already filled.
 */
export function UploadExperience({ seed }: { seed: ReactNode }) {
  const [reported, setReported] = useState<UploadSeedValue | null>(null);
  const report = useCallback((next: UploadSeedValue) => {
    setReported((current) => {
      if (current && current.service === next.service && current.email === next.email) return current;
      return next;
    });
  }, []);

  return (
    <UploadSeedContext.Provider value={report}>
      {seed}
      {reported ? (
        <UploadView initialService={reported.service} sessionEmail={reported.email} />
      ) : (
        <UploadPageFallback />
      )}
    </UploadSeedContext.Provider>
  );
}

export function UploadView({
  initialService,
  sessionEmail,
}: {
  initialService?: string | null;
  sessionEmail?: string | null;
}) {
  const evaluation = parseEvaluationService(initialService);
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
            : "PDF or phone photos. Choose a translation or an evaluation. We’ll price it before you pay."}
        </p>
        <UploadCard initialService={initialService} sessionEmail={sessionEmail} />
      </main>
    </div>
  );
}
