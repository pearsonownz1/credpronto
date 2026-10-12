"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { ReadingFiles } from "./reading-files";
import { FlowStatus } from "./status";

type Phase = "idle" | "uploading" | "reading";

type HandoffState = {
  phase: Phase;
  uploadRatio: number | null;
  order: CustomerOrder | null;
};

type ReadingHandoffApi = {
  covering: boolean;
  uploadRatio: number | null;
  order: CustomerOrder | null;
  phase: Phase;
  beginUpload: () => void;
  setUploadRatio: (ratio: number) => void;
  orderCreated: () => void;
  endHandoff: () => void;
  reportOrder: (order: CustomerOrder) => void;
};

const INITIAL: HandoffState = { phase: "idle", uploadRatio: null, order: null };

const ReadingHandoffContext = createContext<ReadingHandoffApi | null>(null);

export function useReadingHandoff(): ReadingHandoffApi {
  const value = useContext(ReadingHandoffContext);
  return value ?? IDLE_API;
}

export function ReadingHandoff({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HandoffState>(INITIAL);

  const beginUpload = useCallback(() => {
    setState({ phase: "uploading", uploadRatio: null, order: null });
  }, []);

  const setUploadRatio = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio)) return;
    setState((current) =>
      current.phase === "uploading" ? { ...current, uploadRatio: ratio } : current,
    );
  }, []);

  const orderCreated = useCallback(() => {
    setState((current) => (current.phase === "idle" ? current : { ...current, phase: "reading" }));
  }, []);

  const endHandoff = useCallback(() => {
    setState(INITIAL);
  }, []);

  const reportOrder = useCallback((order: CustomerOrder) => {
    setState((current) => {
      if (current.phase === "idle") return current;
      if (order.status === "draft") return { ...current, phase: "reading", order };
      return INITIAL;
    });
  }, []);

  const api = useMemo<ReadingHandoffApi>(
    () => ({
      covering: state.phase !== "idle",
      uploadRatio: state.uploadRatio,
      order: state.order,
      phase: state.phase,
      beginUpload,
      setUploadRatio,
      orderCreated,
      endHandoff,
      reportOrder,
    }),
    [state, beginUpload, setUploadRatio, orderCreated, endHandoff, reportOrder],
  );

  return (
    <ReadingHandoffContext.Provider value={api}>
      <div className={state.phase === "idle" ? "flex min-h-full flex-1 flex-col" : "hidden"}>{children}</div>
      {state.phase === "idle" ? null : <ReadingCover state={state} />}
    </ReadingHandoffContext.Provider>
  );
}

function ReadingCover({ state }: { state: HandoffState }) {
  const uploading = state.phase === "uploading";
  return (
    <div data-testid="reading-handoff" className="flex min-h-full flex-1 flex-col">
      <FlowHeader current="quote" />
      <main className="flex-1">
        <ReadingFiles
          status={state.order?.status ?? "draft"}
          progress={uploading ? undefined : state.order?.progress}
          uploadRatio={uploading ? state.uploadRatio : undefined}
        />
      </main>
    </div>
  );
}

/** Suspense fallback for the order route. Stays blank while the upload handoff is already showing progress. */
export function OrderLoadingFallback() {
  const { covering } = useReadingHandoff();
  if (covering) return null;
  return <FlowStatus title="Loading your order…" body="" />;
}

const IDLE_API: ReadingHandoffApi = {
  covering: false,
  uploadRatio: null,
  order: null,
  phase: "idle",
  beginUpload() {},
  setUploadRatio() {},
  orderCreated() {},
  endHandoff() {},
  reportOrder() {},
};
