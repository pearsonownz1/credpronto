"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { CERTIFICATE_PREVIEW, type PreviewDocument, type PreviewOrder } from "./preview-order";
import { PreviewShell } from "./preview-shell";

const SideBySideViewer = dynamic(
  () => import("./side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <PreviewShell layout="embedded" /> },
);

const evaluationDocument: PreviewDocument = {
  url: "/samples/birth-certificate-en.pdf",
  subtitle: "Diploma evaluation",
  pages: [{ page: 1, widthPt: 612, heightPt: 792 }],
};

/** Local PDFs for the three-pane viewer. Not linked from the public site. */
export function GcsViewerFixture({ initialEvaluation }: { initialEvaluation: boolean }) {
  const [evaluation, setEvaluation] = useState<PreviewDocument | null>(
    initialEvaluation ? evaluationDocument : null,
  );
  const order = useMemo<PreviewOrder>(
    () => ({
      ...CERTIFICATE_PREVIEW,
      ...(evaluation ? { evaluation } : {}),
    }),
    [evaluation],
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1">
        <SideBySideViewer
          order={order}
          chrome="gcs"
          shellLayout="embedded"
          onEvaluate={() => setEvaluation(evaluationDocument)}
        />
      </div>
    </div>
  );
}
