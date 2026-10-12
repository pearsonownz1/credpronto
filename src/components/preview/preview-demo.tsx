"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { PreviewShell } from "./preview-shell";
import { CERTIFICATE_PREVIEW, LONG_PREVIEW } from "./preview-order";

const SideBySideViewer = dynamic(
  () =>
    import("./side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <PreviewShell /> },
);

export function PreviewDemo() {
  const params = useSearchParams();
  const order =
    params.get("sample") === "long" ? LONG_PREVIEW : CERTIFICATE_PREVIEW;

  return <SideBySideViewer order={order} />;
}
