"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchVerification, isAbortError, type Verification } from "@/lib/verify/client";
import {
  downloadNeedsFreshLink,
  fetchedAtAfterRead,
  linkForDownload,
  viewAfterRefresh,
  watchSignedLink,
} from "@/lib/verify/link-refresh";
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
      linkFetchedAt: number;
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

  const linkFetchedAt = phase.step === "valid" ? phase.linkFetchedAt : null;

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

      const fetchedAt = Date.now();
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
        linkFetchedAt: fetchedAt,
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
        setPhase(validFile(verification, fetchedAt, { fileMessage: FILE_UNAVAILABLE }));
        return;
      }
      if (!active) return;
      const loadedAt = fetchedAtAfterRead(source.retried, fetchedAt);
      setPhase(phaseFromSource(source, verification, rememberBlob, loadedAt));
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, held, rememberBlob]);

  useEffect(() => {
    if (linkFetchedAt == null) return;
    const controller = new AbortController();
    let active = true;
    let issuedAt = linkFetchedAt;
    const watch = watchSignedLink({
      getFetchedAt: () => issuedAt,
      isVisible: () => document.visibilityState === "visible",
      onExhausted: () => {
        if (!active) return;
        setPhase({ step: "error" });
      },
      refresh: async () => {
        const next = await fetchVerification(token, { signal: controller.signal });
        if (!active) return "stop";
        const now = Date.now();
        let keep = false;
        setPhase((current) => {
          if (current.step !== "valid") return current;
          const applied = applyFreshLink(current, next, now);
          keep = applied.step === "valid";
          return applied;
        });
        if (!keep) return "stop";
        issuedAt = now;
      },
    });
    document.addEventListener("visibilitychange", watch.onVisibility);
    return () => {
      active = false;
      watch.stop();
      controller.abort();
      document.removeEventListener("visibilitychange", watch.onVisibility);
    };
  }, [linkFetchedAt, token]);

  async function onDownload() {
    if (phase.step !== "valid" || phase.downloading || phase.opening) return;
    const current = phase;
    const filename = downloadFilename(current.verification.reference);
    const currentUrl = current.remote ? current.viewerUrl : current.verification.documentUrl;
    if (current.blob && !current.remote && !downloadNeedsFreshLink(current.linkFetchedAt)) {
      savePdfBlob(current.blob, filename);
      return;
    }

    setPhase({ ...current, downloading: true });
    try {
      const choice = await linkForDownload({
        fetchedAt: current.linkFetchedAt,
        documentUrl: currentUrl,
        refresh: async () => {
          const next = await fetchVerification(token);
          return { fetchedAt: Date.now(), verification: next };
        },
      });
      if (choice.refreshed) {
        const next = choice.verification;
        if (next.status === "revoked") {
          setPhase({ step: "revoked", verification: next });
          return;
        }
        if (next.status !== "valid" || !next.documentUrl) {
          setPhase(
            next.status === "valid"
              ? validFile(next, choice.fetchedAt, { fileMessage: FILE_UNAVAILABLE })
              : { step: "not_found" },
          );
          return;
        }
        setPhase((existing) => {
          if (existing.step !== "valid") return existing;
          return { ...applyFreshLink(existing, next, choice.fetchedAt), downloading: true };
        });
      }

      const verification = choice.refreshed && choice.verification.status === "valid" ? choice.verification : current.verification;
      const documentUrl = choice.refreshed ? choice.verification.documentUrl : choice.documentUrl;
      if (!documentUrl || verification.status !== "valid") return;
      const source = await loadPdfWithOneRetry({ token, documentUrl, verification });
      if (source.kind === "blob") savePdfBlob(source.blob, downloadFilename(source.verification.reference));
      if (source.kind === "url") openDocumentUrl(source.url, downloadFilename(source.verification.reference));
      const loadedAt = fetchedAtAfterRead(source.retried, choice.fetchedAt);
      setPhase(phaseFromSource(source, verification, rememberBlob, loadedAt));
    } catch {
      setPhase(validFile(current.verification, current.linkFetchedAt, { fileMessage: FILE_UNAVAILABLE }));
    }
  }

  return <VerifyScreen {...screenModel(phase, onRetry, () => void onDownload())} />;
}

function applyFreshLink(
  current: Extract<Phase, { step: "valid" }>,
  verification: Verification,
  now: number,
): Phase {
  const result = viewAfterRefresh(
    {
      documentUrl: current.verification.documentUrl,
      viewerUrl: current.viewerUrl,
      remote: current.remote,
      fetchedAt: current.linkFetchedAt,
    },
    verification,
    now,
  );
  if (result.outcome === "revoked") return { step: "revoked", verification };
  if (result.outcome === "not_found") return { step: "not_found" };
  const lostFile = !result.view.viewerUrl && !current.blob;
  return {
    ...current,
    verification,
    viewerUrl: result.view.viewerUrl,
    remote: result.view.remote,
    linkFetchedAt: result.view.fetchedAt,
    opening: false,
    fileMessage: lostFile ? FILE_UNAVAILABLE : null,
  };
}

function phaseFromSource(
  source: PdfSource,
  previous: Verification,
  remember: (blob: Blob) => string,
  linkFetchedAt: number,
): Phase {
  if (source.kind === "status") {
    return source.verification.status === "revoked"
      ? { step: "revoked", verification: source.verification }
      : { step: "not_found" };
  }
  if (source.kind === "blob") {
    return validFile(source.verification, linkFetchedAt, { viewerUrl: remember(source.blob), blob: source.blob });
  }
  if (source.kind === "url") {
    return validFile(source.verification, linkFetchedAt, { viewerUrl: source.url, remote: true });
  }
  return validFile(source.verification.status === "valid" ? source.verification : previous, linkFetchedAt, {
    fileMessage: FILE_UNAVAILABLE,
  });
}

function validFile(
  verification: Verification,
  linkFetchedAt: number,
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
    linkFetchedAt,
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
