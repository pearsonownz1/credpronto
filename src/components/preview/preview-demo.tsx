"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { PreviewShell } from "./preview-shell";

const SideBySideViewer = dynamic(
  () =>
    import("./side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <PreviewShell /> },
);

const SAMPLES = {
  certificate: {
    original: "/samples/birth-certificate-es.pdf",
    translation: "/samples/birth-certificate-en.pdf",
  },
  long: {
    original: "/samples/long-es.pdf",
    translation: "/samples/long-en.pdf",
  },
} as const;

export function PreviewDemo() {
  const params = useSearchParams();
  const sample = params.get("sample") === "long" ? SAMPLES.long : SAMPLES.certificate;

  return (
    <SideBySideViewer original={sample.original} translation={sample.translation} />
  );
}
