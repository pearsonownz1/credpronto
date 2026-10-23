"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchVerification, isAbortError, type Verification } from "@/lib/verify/client";
import { loadPdfWithOneRetry, type PdfSource } from "@/lib/verify/load";
import { downloadFilename, FILE_UNAVAILABLE, verificationFacts } from "@/lib/verify/present";
import { openDocumentUrl, savePdfBlob, VerifyScreen, type VerifyScreenModel } from "./verify-screen";

type Phase =
  | { step: "loading" }
  | { step: "error" }
  | { step: "not_found" }
  | { step: "revoked"; verification: Verification }
  | {
      step: "valid";
      verification: Verification;
      viewerUrl: string | null;
      remote: boolean;
      blob: Blob | null;
      opening: boolean;
      downloading: boolean;
      fileMessage: string | null;
    };

export function VerifyExperience({ token }: { token: string }) {
  const [attempt, setAttempt] = useState(0);
  return <VerifySession key={`${token}:${attempt}`} token={token} onRetry={() => setAttempt((current) => current + 1)} />;
}

function VerifySession({ token, onRetry }: { token: string; onRetry: () => void }) {
  const [phase, setPhase] = useState<Phase>({ step: "loading" });
  const [held] = useState(() => ({ urls: [] as string[] }));

  const rememberBlob = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    held.urls.push(url);
    return url;
  }, [held]);

  useEffect(() => {
    const urls = held.urls;
    return () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    };
  }, [held]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function run() {
      let verification: Verification;
      try {
        verification = await fetchVerification(token, { signal: controller.signal });
      } catch (error) {
        if (!active || isAbortError(error)) return;
        setPhase({ step: "error" });
        return;
      }
      if (!active) return;
      if (verification.status === "revoked") {
        setPhase({ step: "revoked", verification });
        return;
      }
      if (verification.status !== "valid") {
        setPhase({ step: "not_found" });
        return;
      }

      const documentUrl = verification.documentUrl;
      setPhase({
        step: "valid",
        verification,
        viewerUrl: null,
        remote: false,
        blob: null,
        opening: Boolean(documentUrl),
        downloading: false,
        fileMessage: documentUrl ? null : FILE_UNAVAILABLE,
      });
      if (!documentUrl) return;

      let source: PdfSource;
      try {
        source = await loadPdfWithOneRetry({
          token,
          documentUrl,
          verification,
          signal: controller.signal,
        });
      } catch (error) {
        if (!active || isAbortError(error)) return;
        setPhase(validFile(verification, { fileMessage: FILE_UNAVAILABLE }));
        return;
      }
      if (!active) return;
      setPhase(phaseFromSource(source, verification, rememberBlob));
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, held, rememberBlob]);

  async function onDownload() {
    if (phase.step !== "valid" || phase.downloading || phase.opening) return;
    const filename = downloadFilename(phase.verification.reference);
    if (phase.blob && !phase.remote) {
      savePdfBlob(phase.blob, filename);
      return;
    }
    const documentUrl = phase.remote ? phase.viewerUrl : phase.verification.documentUrl;
    if (!documentUrl) return;

    const current = phase;
    setPhase({ ...current, downloading: true });
    try {
      const source = await loadPdfWithOneRetry({
        token,
        documentUrl,
        verification: current.verification,
      });
      if (source.kind === "blob") savePdfBlob(source.blob, downloadFilename(source.verification.reference));
      if (source.kind === "url") openDocumentUrl(source.url, downloadFilename(source.verification.reference));
      setPhase(phaseFromSource(source, current.verification, rememberBlob));
    } catch {
      setPhase(validFile(current.verification, { fileMessage: FILE_UNAVAILABLE }));
    }
  }

  return <VerifyScreen {...screenModel(phase, onRetry, () => void onDownload())} />;
}

function phaseFromSource(
  source: PdfSource,
  previous: Verification,
  remember: (blob: Blob) => string,
): Phase {
  if (source.kind === "status") {
    return source.verification.status === "revoked"
      ? { step: "revoked", verification: source.verification }
      : { step: "not_found" };
  }
  if (source.kind === "blob") {
    return validFile(source.verification, { viewerUrl: remember(source.blob), blob: source.blob });
  }
  if (source.kind === "url") {
    return validFile(source.verification, { viewerUrl: source.url, remote: true });
  }
  return validFile(source.verification.status === "valid" ? source.verification : previous, {
    fileMessage: FILE_UNAVAILABLE,
  });
}

function validFile(
  verification: Verification,
  patch: Partial<Extract<Phase, { step: "valid" }>> = {},
): Extract<Phase, { step: "valid" }> {
  return {
    step: "valid",
    verification,
    viewerUrl: null,
    remote: false,
    blob: null,
    opening: false,
    downloading: false,
    fileMessage: null,
    ...patch,
  };
}

function screenModel(phase: Phase, onRetry: () => void, onDownload: () => void): VerifyScreenModel {
  if (phase.step === "loading") return { state: "loading" };
  if (phase.step === "error") return { state: "error", onRetry };
  if (phase.step === "revoked") return { state: "revoked", ...verificationFacts(phase.verification) };
  if (phase.step === "not_found") return { state: "not_found" };
  return {
    state: "valid",
    ...verificationFacts(phase.verification),
    viewerUrl: phase.viewerUrl,
    opening: phase.opening,
    downloading: phase.downloading,
    fileMessage: phase.fileMessage,
    onDownload,
    onRetry,
  };
}
