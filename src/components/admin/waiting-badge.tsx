"use client";

import { useEffect, useState } from "react";
import { waitingIsLate, waitingLabel, waitingMinutes } from "@/lib/orders/certification-queue";

const TICK_MS = 15_000;

export function WaitingBadge({
  paidAt,
  createdAt,
  now: fixedNow,
}: {
  paidAt: string | null;
  createdAt: string;
  now?: number;
}) {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());

  useEffect(() => {
    if (fixedNow != null) return;
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, [fixedNow]);

  const minutes = waitingMinutes({ paidAt, createdAt }, fixedNow ?? now);
  if (minutes == null) return <span className="text-ink-muted">—</span>;
  const late = waitingIsLate(minutes);
  return (
    <span
      data-testid="waiting-badge"
      data-late={late ? "true" : "false"}
      aria-live="polite"
      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${
        late ? "bg-[#fdecec] text-[#9b1c1c]" : "bg-[#fff4e5] text-[#9a6700]"
      }`}
    >
      {waitingLabel(minutes)}
    </span>
  );
}
