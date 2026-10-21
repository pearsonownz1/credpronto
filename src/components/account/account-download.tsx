"use client";

import { useState } from "react";
import { browserJson } from "@/lib/api/browser";

export function AccountDownload({
  orderId,
  file,
}: {
  orderId: string;
  file: "translation" | "evaluation";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await browserJson<{ url?: string }>(
      `/api/orders/${encodeURIComponent(orderId)}/download?file=${file}`,
    );
    setPending(false);
    if (!result.ok || !result.data.url) {
      setError(result.ok ? "That file is not ready" : result.error);
      return;
    }
    window.location.assign(result.data.url);
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        data-testid={`download-${orderId}`}
        disabled={pending}
        onClick={() => void onClick()}
        className="inline-flex h-9 items-center justify-center rounded-[4px] bg-[#1F5EFF] px-3 text-[13px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Download"}
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-[#b45309]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
