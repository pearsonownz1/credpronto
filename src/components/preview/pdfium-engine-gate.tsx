"use client";

import { usePdfiumEngine } from "@embedpdf/engines/react";
import type { PdfEngine } from "@embedpdf/models";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { delayBeforePreviewAttempt } from "./preview-retry";

/**
 * Remounts PDFium after a failed init. The hook itself never retries, and a
 * failed engine stays failed until the component is created again.
 */
export function PdfiumEngineGate({
  wasmUrl,
  loading,
  failed,
  children,
}: {
  wasmUrl: string;
  loading: ReactNode;
  failed: (retry: () => void) => ReactNode;
  children: (engine: PdfEngine<Blob>) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  const retry = useCallback(() => {
    setGaveUp(false);
    setAttempt(0);
    setCycle((value) => value + 1);
  }, []);
  const giveUp = useCallback(() => {
    setGaveUp(true);
  }, []);

  if (gaveUp) return failed(retry);

  return (
    <PdfiumEngineAttempt
      key={`${wasmUrl}:${cycle}:${attempt}`}
      wasmUrl={wasmUrl}
      attempt={attempt}
      loading={loading}
      onAdvance={setAttempt}
      onGiveUp={giveUp}
    >
      {children}
    </PdfiumEngineAttempt>
  );
}

function PdfiumEngineAttempt({
  wasmUrl,
  attempt,
  loading,
  onAdvance,
  onGiveUp,
  children,
}: {
  wasmUrl: string;
  attempt: number;
  loading: ReactNode;
  onAdvance: (attempt: number) => void;
  onGiveUp: () => void;
  children: (engine: PdfEngine<Blob>) => ReactNode;
}) {
  const engineState = usePdfiumEngine({ wasmUrl });

  useEffect(() => {
    if (!engineState.error) return;
    const delay = delayBeforePreviewAttempt(attempt + 1);
    if (delay === null) {
      onGiveUp();
      return;
    }
    const timer = window.setTimeout(() => onAdvance(attempt + 1), delay);
    return () => window.clearTimeout(timer);
  }, [attempt, engineState.error, onAdvance, onGiveUp]);

  if (engineState.engine) return children(engineState.engine);
  return loading;
}
