"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { formatOrderDate } from "@/lib/account/present";
import {
  getOrderCorrection,
  getOrderMailing,
  getOrderNotarization,
  isNotarizationStatus,
  mailingDraftFrom,
  patchOrderNotarization,
  runCorrectionUpload,
  saveOrderMailing,
  type FinalCorrection,
  type MailingDraft,
  type MailingView,
  type NotarizationView,
} from "@/lib/api/order-fulfillment";
import { US_STATE_CODES } from "@/lib/orders/addons";

type Load<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

const fieldClass = "h-9 rounded-[var(--cp-radius)] border border-line bg-white px-2 text-sm";
const buttonClass =
  "inline-flex h-9 items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60";

export function OrderFulfillment({ orderId }: { orderId: string }) {
  const [correction, setCorrection] = useState<Load<FinalCorrection | null>>({ status: "loading" });
  const [notarization, setNotarization] = useState<Load<NotarizationView>>({ status: "loading" });
  const [mailing, setMailing] = useState<Load<MailingView>>({ status: "loading" });
  const [pending, setPending] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);
  const [notarizationError, setNotarizationError] = useState<string | null>(null);
  const [notarizationMessage, setNotarizationMessage] = useState<string | null>(null);
  const [mailingError, setMailingError] = useState<string | null>(null);
  const [mailingMessage, setMailingMessage] = useState<string | null>(null);
  const [loadedOrderId, setLoadedOrderId] = useState(orderId);

  if (loadedOrderId !== orderId) {
    setLoadedOrderId(orderId);
    setCorrection({ status: "loading" });
    setNotarization({ status: "loading" });
    setMailing({ status: "loading" });
    setPending(null);
    setCorrectionError(null);
    setCorrectionMessage(null);
    setNotarizationError(null);
    setNotarizationMessage(null);
    setMailingError(null);
    setMailingMessage(null);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [nextCorrection, nextNotarization, nextMailing] = await Promise.all([
        getOrderCorrection(orderId),
        getOrderNotarization(orderId),
        getOrderMailing(orderId),
      ]);
      if (cancelled) return;
      setCorrection(
        nextCorrection.ok
          ? { status: "ready", data: nextCorrection.data.correction }
          : { status: "error", error: nextCorrection.error },
      );
      setNotarization(
        nextNotarization.ok
          ? { status: "ready", data: nextNotarization.data }
          : { status: "error", error: nextNotarization.error },
      );
      setMailing(
        nextMailing.ok ? { status: "ready", data: nextMailing.data } : { status: "error", error: nextMailing.error },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function uploadFix(file: File | null, form: HTMLFormElement) {
    if (correction.status !== "ready" || !correction.data) return;
    setPending("correction");
    setCorrectionError(null);
    setCorrectionMessage(null);
    const outcome = await runCorrectionUpload({ orderId, correction: correction.data, file });
    setPending(null);
    setCorrection({ status: "ready", data: outcome.correction });
    setCorrectionError(outcome.error);
    setCorrectionMessage(outcome.message);
    if (outcome.message) form.reset();
  }

  async function saveNotarization(status: string) {
    if (!isNotarizationStatus(status) || notarization.status !== "ready") return;
    if (notarization.data.status === status) return;
    setPending("notarization");
    setNotarizationError(null);
    setNotarizationMessage(null);
    const result = await patchOrderNotarization(orderId, { status });
    setPending(null);
    if (!result.ok) {
      setNotarizationError(result.error);
      return;
    }
    setNotarization({ status: "ready", data: result.data });
    setNotarizationMessage("Notarization saved.");
  }

  async function saveMailing(draft: MailingDraft) {
    setPending("mailing");
    setMailingError(null);
    setMailingMessage(null);
    const result = await saveOrderMailing(orderId, draft);
    setPending(null);
    if (!result.ok) {
      setMailingError(result.error);
      return;
    }
    setMailing({ status: "ready", data: result.data });
    setMailingMessage("Mailing saved.");
  }

  return (
    <div data-testid="order-fulfillment" className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <CorrectionSection
          state={correction}
          pending={pending}
          error={correctionError}
          message={correctionMessage}
          onUpload={uploadFix}
        />
        <NotarizationSection
          state={notarization}
          pending={pending}
          error={notarizationError}
          message={notarizationMessage}
          onStatus={saveNotarization}
        />
      </div>
      <MailingSection
        state={mailing}
        pending={pending}
        error={mailingError}
        message={mailingMessage}
        onSave={saveMailing}
      />
    </div>
  );
}

function Card({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="grid content-start gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Notice({
  tone,
  testId,
  children,
}: {
  tone: "error" | "ok" | "muted";
  testId?: string;
  children: ReactNode;
}) {
  const className =
    tone === "error" ? "text-sm text-[#b45309]" : tone === "ok" ? "text-sm text-[var(--cp-ok)]" : "text-sm text-ink-muted";
  return (
    <p role={tone === "error" ? "alert" : tone === "ok" ? "status" : undefined} data-testid={testId} className={className}>
      {children}
    </p>
  );
}

export function CorrectionSection({
  state,
  pending,
  error,
  message,
  onUpload,
}: {
  state: Load<FinalCorrection | null>;
  pending: string | null;
  error: string | null;
  message: string | null;
  onUpload: (file: File | null, form: HTMLFormElement) => void;
}) {
  return (
    <Card title="Corrections" testId="final-correction">
      {state.status === "loading" ? <Notice tone="muted">Loading…</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      {state.status === "ready" && !state.data ? (
        <Notice tone="muted" testId="correction-empty">
          This order has no correction.
        </Notice>
      ) : null}
      {state.status === "ready" && state.data ? (
        <CorrectionBody
          correction={state.data}
          pending={pending}
          error={error}
          message={message}
          onUpload={onUpload}
        />
      ) : null}
    </Card>
  );
}

function CorrectionBody({
  correction,
  pending,
  error,
  message,
  onUpload,
}: {
  correction: FinalCorrection;
  pending: string | null;
  error: string | null;
  message: string | null;
  onUpload: (file: File | null, form: HTMLFormElement) => void;
}) {
  const busy = pending === "correction";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entry = new FormData(event.currentTarget).get("file");
    onUpload(entry instanceof File ? entry : null, event.currentTarget);
  }

  return (
    <div className="grid gap-3">
      <p className="whitespace-pre-wrap text-sm" data-testid="correction-text">
        {correction.text}
      </p>
      <p className="text-sm" data-testid="correction-status">
        Status: {correction.status}
      </p>
      <p className="text-xs text-ink-muted">{formatOrderDate(correction.createdAt)}</p>
      {correction.status === "in_progress" && correction.claimedAt ? (
        <p className="text-xs text-ink-muted">Claimed {formatOrderDate(correction.claimedAt)}</p>
      ) : null}
      {correction.status === "fixed" && correction.finalPath ? (
        <p className="break-all font-mono text-xs text-ink-muted" data-testid="correction-final-path">
          {correction.finalPath}
        </p>
      ) : null}
      {correction.status === "open" || correction.status === "in_progress" ? (
        <form className="grid gap-2" onSubmit={submit}>
          <p className="text-sm text-ink-muted">
            {correction.status === "open"
              ? "Uploading claims this correction, then stores the fixed PDF."
              : "This correction is claimed. Upload the fixed PDF."}
          </p>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Fixed PDF</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              data-testid="correction-file"
              disabled={pending !== null}
              className="min-w-0 text-sm file:mr-3 file:rounded-[var(--cp-radius)] file:border file:border-line file:bg-white file:px-2 file:py-1 file:text-sm file:font-semibold disabled:opacity-60"
            />
          </label>
          <button type="submit" data-testid="correction-upload" disabled={pending !== null} className={`${buttonClass} w-fit`}>
            {busy ? "Uploading…" : "Upload fixed PDF"}
          </button>
        </form>
      ) : null}
      {error ? (
        <Notice tone="error" testId="correction-error">
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice tone="ok" testId="correction-message">
          {message}
        </Notice>
      ) : null}
    </div>
  );
}

export function NotarizationSection({
  state,
  pending,
  error,
  message,
  onStatus,
}: {
  state: Load<NotarizationView>;
  pending: string | null;
  error: string | null;
  message: string | null;
  onStatus: (status: string) => void;
}) {
  return (
    <Card title="Notarization" testId="order-notarization">
      {state.status === "loading" ? <Notice tone="muted">Loading…</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      {state.status === "ready" && !state.data.needed ? (
        <Notice tone="muted" testId="notarization-empty">
          This order does not need notarization.
        </Notice>
      ) : null}
      {state.status === "ready" && state.data.needed ? (
        <div className="grid gap-3">
          <p className="text-sm" data-testid="notarization-needed">
            Needed
          </p>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Status</span>
            <select
              data-testid="notarization-status"
              value={state.data.status ?? ""}
              disabled={pending !== null}
              onChange={(event) => onStatus(event.target.value)}
              className={fieldClass}
            >
              <option value="" disabled>
                Choose a status
              </option>
              <option value="pending">pending</option>
              <option value="notarized">notarized</option>
              <option value="done">done</option>
            </select>
          </label>
          {error ? (
            <Notice tone="error" testId="notarization-error">
              {error}
            </Notice>
          ) : null}
          {message ? (
            <Notice tone="ok" testId="notarization-message">
              {message}
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function MailingSection({
  state,
  pending,
  error,
  message,
  onSave,
}: {
  state: Load<MailingView>;
  pending: string | null;
  error: string | null;
  message: string | null;
  onSave: (draft: MailingDraft) => void;
}) {
  return (
    <Card title="Mailing" testId="order-mailing">
      {state.status === "loading" ? <Notice tone="muted">Loading…</Notice> : null}
      {state.status === "error" ? <Notice tone="error">{state.error}</Notice> : null}
      {state.status === "ready" && !state.data.needed ? (
        <Notice tone="muted" testId="mailing-empty">
          This order does not need mailing.
        </Notice>
      ) : null}
      {state.status === "ready" && state.data.needed ? (
        <MailingForm key={mailingKey(state.data)} mailing={state.data} pending={pending} error={error} message={message} onSave={onSave} />
      ) : null}
    </Card>
  );
}

function mailingKey(mailing: MailingView): string {
  return JSON.stringify(mailing);
}

function MailingForm({
  mailing,
  pending,
  error,
  message,
  onSave,
}: {
  mailing: MailingView;
  pending: string | null;
  error: string | null;
  message: string | null;
  onSave: (draft: MailingDraft) => void;
}) {
  const [draft, setDraft] = useState<MailingDraft>(() => mailingDraftFrom(mailing));
  const busy = pending === "mailing";

  function patch(partial: Partial<MailingDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <p className="text-sm" data-testid="mailing-needed">
        Needed
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ship to" className="sm:col-span-2">
          <input
            data-testid="mailing-name"
            value={draft.name}
            autoComplete="name"
            disabled={pending !== null}
            onChange={(event) => patch({ name: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input
            data-testid="mailing-line1"
            value={draft.line1}
            autoComplete="address-line1"
            disabled={pending !== null}
            onChange={(event) => patch({ line1: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="Address line 2" className="sm:col-span-2">
          <input
            data-testid="mailing-line2"
            value={draft.line2}
            autoComplete="address-line2"
            disabled={pending !== null}
            onChange={(event) => patch({ line2: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="City">
          <input
            data-testid="mailing-city"
            value={draft.city}
            autoComplete="address-level2"
            disabled={pending !== null}
            onChange={(event) => patch({ city: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="State">
          <select
            data-testid="mailing-state"
            value={draft.state}
            autoComplete="address-level1"
            disabled={pending !== null}
            onChange={(event) => patch({ state: event.target.value })}
            className={`${fieldClass} w-full`}
          >
            <option value="">Select</option>
            {draft.state && !(US_STATE_CODES as readonly string[]).includes(draft.state) ? (
              <option value={draft.state}>{draft.state}</option>
            ) : null}
            {US_STATE_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ZIP code">
          <input
            data-testid="mailing-postal"
            value={draft.postalCode}
            autoComplete="postal-code"
            inputMode="numeric"
            disabled={pending !== null}
            onChange={(event) => patch({ postalCode: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="Country">
          <input
            data-testid="mailing-country"
            value={draft.country}
            autoComplete="country"
            disabled={pending !== null}
            onChange={(event) => patch({ country: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="Carrier">
          <input
            data-testid="mailing-carrier"
            value={draft.carrier}
            maxLength={40}
            disabled={pending !== null}
            onChange={(event) => patch({ carrier: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
        <Field label="Tracking number">
          <input
            data-testid="mailing-tracking"
            value={draft.trackingNumber}
            maxLength={80}
            disabled={pending !== null}
            onChange={(event) => patch({ trackingNumber: event.target.value })}
            className={`${fieldClass} w-full`}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          data-testid="mailing-shipped"
          type="checkbox"
          checked={draft.shipped}
          disabled={pending !== null}
          onChange={(event) => patch({ shipped: event.target.checked })}
        />
        Shipped
      </label>
      {mailing.shippedAt ? <p className="text-xs text-ink-muted">Shipped {formatOrderDate(mailing.shippedAt)}</p> : null}
      <button type="submit" data-testid="mailing-save" disabled={pending !== null} className={`${buttonClass} w-fit`}>
        {busy ? "Saving…" : "Save mailing"}
      </button>
      {error ? (
        <Notice tone="error" testId="mailing-error">
          {error}
        </Notice>
      ) : null}
      {message ? (
        <Notice tone="ok" testId="mailing-message">
          {message}
        </Notice>
      ) : null}
    </form>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`grid gap-1 text-sm ${className ?? ""}`}>
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  );
}
