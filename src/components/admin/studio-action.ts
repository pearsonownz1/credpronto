export type StudioTaskResult = {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string | null;
};

export type StudioSettlement = {
  error: string | null;
  message: string | null;
  refresh: boolean;
  status: string | null;
};

export function approveButtonLabel(pending: string | null): string {
  return pending === "approve" ? "Approving…" : "Approve and release";
}

/** Approve stays off until a staff upload is the current final. */
export function approveButtonDisabled(
  pending: string | null,
  versions: readonly { current: boolean }[],
): boolean {
  return pending !== null || !versions.some((version) => version.current);
}

/** Apply one studio action. Status changes and a refresh happen only after ok. */
export function settleStudioAction(result: StudioTaskResult | null | undefined): StudioSettlement {
  if (!result?.ok) {
    return {
      error: result?.error?.trim() || "Request failed",
      message: null,
      refresh: false,
      status: null,
    };
  }
  return {
    error: null,
    message: result.message ?? null,
    refresh: true,
    status: result.status?.trim() || null,
  };
}

export async function runStudioAction(task: () => Promise<StudioTaskResult>): Promise<StudioSettlement> {
  try {
    return settleStudioAction(await task());
  } catch (error) {
    return settleStudioAction({
      ok: false,
      error: error instanceof Error && error.message.trim() ? error.message : "Request failed",
    });
  }
}
