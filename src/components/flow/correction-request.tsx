"use client";

import { useState, type FormEvent } from "react";
import { requestFailedMessage } from "@/lib/flow/api-error";
import { flowUsesMock } from "@/lib/flow/client";
import type { CustomerOrder } from "@/lib/orders/view";
import { buttonClasses } from "./ui";

const TEXT_MAX = 4000;

type SubmittedCorrection = { status: string };

function activeFinalCorrection(order: CustomerOrder): SubmittedCorrection | null {
  const status = order.finalCorrection?.status;
  if (status === "open" || status === "in_progress") return { status };
  return null;
}

function correctionStatusLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "in_progress") return "In progress";
  if (status === "fixed") return "Fixed";
  return status;
}

async function submitCorrectionRequest(token: string, text: string): Promise<SubmittedCorrection> {
  if (flowUsesMock()) return { status: "open" };
  const response = await fetch(`/api/orders/${encodeURIComponent(token)}/correction-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }
  if (!response.ok) {
    throw new Error(requestFailedMessage(body, response.status, response.statusText));
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("The correction request didn't go through.");
  }
  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !status.trim()) {
    throw new Error("The correction request didn't go through.");
  }
  return { status };
}

function CorrectionRequested({ status }: { status: string }) {
  return (
    <div
      data-testid="correction-requested"
      role="status"
      className="mt-4 rounded-[var(--cp-radius)] border border-line bg-white px-4 py-3"
    >
      <p className="font-semibold text-ink">Correction requested</p>
      <p data-testid="correction-status" data-status={status} className="mt-1 text-sm text-ink-muted">
        Status: {correctionStatusLabel(status)}
      </p>
    </div>
  );
}

/** Delivered-order correction. The endpoint accepts `{ text }` and returns the request status. */
export function CorrectionRequest({ token, order }: { token: string; order: CustomerOrder }) {
  const existing = activeFinalCorrection(order);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedCorrection | null>(existing);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const description = text.trim();
    if (pending) return;
    if (!description) {
      setError("Describe what's wrong.");
      return;
    }
    if (description.length > TEXT_MAX) {
      setError("Describe the problem in 4000 characters or fewer.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setSubmitted(await submitCorrectionRequest(token, description));
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "The correction request didn't go through.");
    } finally {
      setPending(false);
    }
  }

  if (submitted) return <CorrectionRequested status={submitted.status} />;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="request-correction"
        className="mt-4 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-[var(--cp-radius)] border border-primary bg-white px-4 text-[15px] font-semibold text-primary hover:bg-bg-muted"
        onClick={() => setOpen(true)}
      >
        Request a correction
      </button>
    );
  }

  return (
    <form
      data-testid="correction-form"
      onSubmit={onSubmit}
      aria-busy={pending}
      className="mt-4 grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
    >
      <label htmlFor="correction-text" className="text-[13px] font-semibold text-ink">
        What&apos;s wrong?
      </label>
      <textarea
        id="correction-text"
        name="text"
        data-testid="correction-text"
        required
        aria-required="true"
        maxLength={TEXT_MAX}
        rows={4}
        value={text}
        disabled={pending}
        placeholder="Describe what should be corrected."
        onChange={(event) => setText(event.target.value)}
        className="min-h-28 w-full resize-y rounded-[var(--cp-radius)] border border-line bg-white px-3 py-2 text-[15px] text-ink outline-none focus:border-primary disabled:opacity-60"
      />
      {error ? (
        <p data-testid="correction-error" role="alert" className="text-sm text-[var(--cp-warn)]">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        data-testid="correction-submit"
        disabled={pending || text.trim().length === 0}
        className={buttonClasses("primary", "h-11 w-full px-4 text-[15px] disabled:opacity-60")}
      >
        {pending ? "Sending…" : error ? "Try again" : "Submit request"}
      </button>
    </form>
  );
}
