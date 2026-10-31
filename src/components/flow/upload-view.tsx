"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
} from "@/lib/evaluations/catalog";
import type { FlowTrack } from "@/lib/flow/types";
import { getPreEvaluationFile, getPreEvaluationPrefill, type PreEvaluationFile } from "@/lib/pre-evaluation/client";
import { FlowHeader } from "./flow-header";
import { UploadCard } from "./upload-card";
import { uploadServiceFromQuery } from "./upload-draft";

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

type UploadSeedValue = {
  service: string | null;
  email: string | null;
  degreeCount: number | null;
  preEvaluationId: string | null;
  carriedFile: PreEvaluationFile | null;
};

const UploadSeedContext = createContext<(seed: UploadSeedValue) => void>(() => {});

/** Reports the URL service, signed-in email, and any pre-evaluation order fields without remounting the form. */
export function UploadSeed({
  initialService,
  sessionEmail,
  preEvaluationId,
}: {
  initialService?: string | null;
  sessionEmail?: string | null;
  preEvaluationId?: string | null;
}) {
  const report = useContext(UploadSeedContext);
  useEffect(() => {
    let cancelled = false;
    report({
      service: initialService ?? null,
      email: sessionEmail ?? null,
      degreeCount: null,
      preEvaluationId: null,
      carriedFile: null,
    });
    const id = preEvaluationId?.trim();
    if (!id) return;
    void Promise.all([
      getPreEvaluationPrefill(id).catch(() => null),
      // A 404 means the stored file cannot be carried. Any other failure leaves the normal upload.
      getPreEvaluationFile(id)
        .then((body) => body.preEvaluationFile)
        .catch(() => null),
    ]).then(([prefill, carriedFile]) => {
      if (cancelled || !prefill) return;
      report({
        service: prefill.service,
        email: sessionEmail ?? prefill.email,
        degreeCount: prefill.degreeCount,
        preEvaluationId: carriedFile ? id : null,
        carriedFile,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [report, initialService, sessionEmail, preEvaluationId]);
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
      if (
        current &&
        current.service === next.service &&
        current.email === next.email &&
        current.degreeCount === next.degreeCount &&
        current.preEvaluationId === next.preEvaluationId &&
        current.carriedFile === next.carriedFile
      ) {
        return current;
      }
      return next;
    });
  }, []);

  return (
    <UploadSeedContext.Provider value={report}>
      {seed}
      {reported ? (
        <UploadView
          initialService={reported.service}
          sessionEmail={reported.email}
          initialDegreeCount={reported.degreeCount}
          preEvaluationId={reported.preEvaluationId}
          carriedFile={reported.carriedFile}
        />
      ) : (
        <UploadPageFallback />
      )}
    </UploadSeedContext.Provider>
  );
}

export function UploadView({
  initialService,
  sessionEmail,
  initialDegreeCount = null,
  preEvaluationId = null,
  carriedFile = null,
}: {
  initialService?: string | null;
  sessionEmail?: string | null;
  initialDegreeCount?: number | null;
  preEvaluationId?: string | null;
  carriedFile?: PreEvaluationFile | null;
}) {
  const [track, setTrack] = useState<FlowTrack>(() => {
    const service = uploadServiceFromQuery(initialService);
    return service === "diploma" || service === "course_by_course" ? "evaluation" : "translation";
  });
  const evaluation = track === "evaluation";
  const bundle = track === "bundle";
  return (
    <div>
      <FlowHeader current="upload" track={track} />
      <main className="mx-auto w-full max-w-[560px] px-4 py-10 md:py-16">
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          {evaluation || bundle ? "Upload the degree" : "Upload your documents"}
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          {evaluation
            ? `PDF or phone photos. Diploma evaluation is ${DIPLOMA_PRICE_LABEL}. Course-by-course is ${COURSE_BY_COURSE_PRICE_LABEL}. We'll email you when it's ready to review.`
            : bundle
              ? `PDF or phone photos. Diploma evaluation is ${DIPLOMA_PRICE_LABEL}. Course-by-course is ${COURSE_BY_COURSE_PRICE_LABEL}. We’ll price the translation before you pay.`
              : "PDF or phone photos. Choose a translation or an evaluation. We’ll price it before you pay."}
        </p>
        <UploadCard
          initialService={initialService}
          sessionEmail={sessionEmail}
          initialDegreeCount={initialDegreeCount}
          preEvaluationId={preEvaluationId}
          carriedFile={carriedFile}
          onTrackChange={setTrack}
        />
      </main>
    </div>
  );
}
