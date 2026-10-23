"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { activityFor } from "@/lib/account/activity";
import { formatOrderDate, formatOrderMoney } from "@/lib/account/present";
import {
  addNote,
  assignEquivalency,
  approveOrder,
  setEvaluationStatus,
  uploadEvaluationReport,
  notarizeOrder,
  patchOrderTranslation,
  refundOrder,
  regenerateOrder,
  resolveReview,
  shipOrder,
} from "@/lib/api/mutations";
import type { StaffDetail, StaffNote } from "@/lib/api/types";
import { EQUIVALENCY_QA_REVIEW, PENDING_EQUIVALENCY, awaitingEquivalencyPublish } from "@/lib/orders/equivalency";
import { languageLabel } from "@/lib/orders/languages";
import type { PreviewOrder, PreviewPageSize } from "@/components/preview/preview-order";
import { humanStatus } from "@/components/admin/orders-board";
import { QaPanel } from "@/components/admin/qa-panel";
import { StaffFiles } from "@/components/admin/staff-files";
import { approveButtonLabel, runStudioAction, type StudioTaskResult } from "@/components/admin/studio-action";
import { NeedsReviewBanner } from "@/components/admin/needs-review-banner";
import { OrderFulfillment } from "@/components/admin/order-fulfillment";
import {
  applyReportOverrides,
  evaluationReportsFor,
  evaluationUploadMessage,
  evaluationUploadStatus,
  type ReportOverride,
} from "@/components/admin/evaluation-report-model";
import { EvaluationReportBoxes, MissingEvaluationReports } from "@/components/admin/evaluation-reports";
import { sourceTextForDisplay } from "@/lib/orders/source-text";
import { emptyTranslationMessage } from "@/lib/orders/translation-edit";
import type { ViewerFocus } from "@/components/preview/side-by-side-viewer";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <p className="p-6 text-sm text-ink-muted">Loading documents…</p> },
);

const EDITABLE = new Set(["preview_ready", "correction_requested", "paid", "approved", "delivered"]);

function EdgeReference({ edge }: { edge: NonNullable<StaffDetail["edge"]> }) {
  const level = [edge.levelNumber != null ? `Level ${edge.levelNumber}` : null, edge.levelTitle]
    .filter(Boolean)
    .join(" · ");
  return (
    <section
      data-testid="edge-reference"
      className="mt-3 grid gap-2 rounded-[var(--cp-radius)] border border-line bg-white p-4"
    >
      <p className="text-sm font-semibold">EDGE reference</p>
      <p className="text-sm">{edge.title}</p>
      {level ? <p className="text-sm text-ink-muted">{level}</p> : null}
      {edge.contentExcerpt ? <p className="text-sm">{edge.contentExcerpt}</p> : null}
      {edge.url ? (
        <a href={edge.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary">
          Open EDGE entry
        </a>
      ) : null}
      {edge.gradingScale ? (
        <div className="grid gap-1">
          <p className="text-sm font-semibold">{edge.gradingScale.title}</p>
          <table className="w-full text-sm">
            <tbody>
              {edge.gradingScale.rows.slice(0, 40).map((row) => (
                <tr key={`${row.indigenousGrade}-${row.usEquivalent}`}>
                  <td className="py-0.5 pr-4">{row.indigenousGrade}</td>
                  <td className="py-0.5">{row.usEquivalent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function OrderStudio({
  detail,
  notes,
  notesError,
}: {
  detail: StaffDetail;
  notes: StaffNote[];
  notesError: string | null;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(detail.pages.map((page) => [page.id, page.paragraphs.length > 0 ? page.paragraphs : [""]])),
  );
  const [thread, setThread] = useState(notes);
  const [note, setNote] = useState("");
  const [language, setLanguage] = useState(detail.sourceLanguage ?? "");
  const [equivalencies, setEquivalencies] = useState(() =>
    (detail.equivalencyCredentials.length > 0 ? detail.equivalencyCredentials : [null]).map((item) => ({
      usEquivalency: !item || item.usEquivalency === PENDING_EQUIVALENCY ? "" : item.usEquivalency,
      country: !item || item.country === PENDING_EQUIVALENCY ? "" : item.country,
      field: !item || item.field === PENDING_EQUIVALENCY ? "" : item.field,
      dates: !item || item.dates === PENDING_EQUIVALENCY ? "" : item.dates,
    })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState(detail.status);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [focusPage, setFocusPage] = useState<ViewerFocus | null>(null);
  const focusNonce = useRef(0);
  const preview = useMemo(() => staffPreview(detail), [detail]);
  const activity = activityFor(detail, thread);
  const canEdit = EDITABLE.has(detail.status);
  const [reportOverrides, setReportOverrides] = useState<Record<string, ReportOverride>>({});
  const blobUrls = useRef<string[]>([]);
  useEffect(() => {
    const stored = blobUrls;
    return () => {
      for (const url of stored.current) URL.revokeObjectURL(url);
    };
  }, []);
  const reports = applyReportOverrides(evaluationReportsFor(detail), reportOverrides);

  function updateParagraph(pageId: string, index: number, value: string) {
    setDrafts((current) => {
      const next = [...(current[pageId] ?? [""])];
      next[index] = value;
      return { ...current, [pageId]: next };
    });
  }

  async function run(action: string, task: () => Promise<StudioTaskResult>) {
    setPending(action);
    setError(null);
    setMessage(null);
    const settled = await runStudioAction(task);
    setPending(null);
    setError(settled.error);
    setMessage(settled.message);
    if (settled.status) setStatus(settled.status);
    if (settled.refresh) router.refresh();
  }

  async function save() {
    const pages = detail.pages.flatMap((page) => {
      const next = (drafts[page.id] ?? []).map((paragraph) => paragraph.trim()).filter(Boolean);
      const previous = page.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
      if (JSON.stringify(next) === JSON.stringify(previous)) return [];
      return [{ documentId: page.documentId, pageNumber: page.pageNumber, paragraphs: next }];
    });
    if (pages.length === 0) {
      setError("Change a page before saving.");
      return;
    }
    if (pages.some((page) => page.paragraphs.length === 0)) {
      setError("Keep at least one paragraph on each edited page.");
      return;
    }
    await run("save", async () => {
      const result = await patchOrderTranslation(detail.id, pages);
      return result.ok
        ? { ok: true, message: "Translation saved. The preview, clean PDF, and certification were regenerated." }
        : { ok: false, error: result.error };
    });
  }

  function uploadReport(service: "diploma" | "course_by_course", file: File) {
    void run(`report-${service}`, async () => {
      const result = await uploadEvaluationReport(detail.id, service, file);
      if (!result.ok) return { ok: false, error: result.error };
      const url = URL.createObjectURL(file);
      blobUrls.current.push(url);
      setReportOverrides((current) => {
        const previous = current[service]?.url;
        if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
        return { ...current, [service]: { fileName: file.name, url } };
      });
      return {
        ok: true,
        message: evaluationUploadMessage(service, result.data),
        status: evaluationUploadStatus(result.data),
      };
    });
  }

  return (
    <div data-testid="order-studio" className="grid gap-6">
      <div>
        <Link href="/admin" className="text-sm font-semibold text-primary">
          All orders
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-mono text-[22px] tracking-[-0.4px]">{detail.id}</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {detail.expedited ? "Expedited · " : ""}
              {detail.email ?? "No customer email"} · <span data-testid="order-status">{humanStatus(status)}</span> ·{" "}
              {detail.sourceLanguage ? languageLabel(detail.sourceLanguage) : "Language unset"} →{" "}
              {languageLabel(detail.targetLanguage)} · {formatOrderMoney(detail.totalCents)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                data-testid="save-translation"
                disabled={pending !== null}
                onClick={() => void save()}
                className="inline-flex h-9 items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pending === "save" ? "Saving…" : "Save translation"}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="regenerate-preview"
              disabled={pending !== null}
              onClick={() =>
                void run("regenerate", async () => {
                  const result = await regenerateOrder(detail.id);
                  return result.ok
                    ? { ok: true, message: "Regeneration started from the current source text." }
                    : { ok: false, error: result.error };
                })
              }
              className="inline-flex h-9 items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 text-sm font-semibold disabled:opacity-60"
            >
              {pending === "regenerate" ? "Regenerating…" : "Regenerate preview"}
            </button>
            {status === "paid" || status === "approved" ? (
              <>
              <MissingEvaluationReports reports={reports} />
              <button
                type="button"
                data-testid="approve-order"
                aria-busy={pending === "approve"}
                disabled={pending !== null}
                onClick={() => {
                  const empty = detail.service ? null : emptyTranslationMessage(detail.pages);
                  if (empty) {
                    setError(empty);
                    setMessage(null);
                    return;
                  }
                  void run("approve", async () => {
                    const result = await approveOrder(detail.id);
                    const data =
                      result.ok && result.data && typeof result.data === "object"
                        ? (result.data as { email?: unknown; status?: unknown })
                        : null;
                    const email = data && "email" in data ? String(data.email ?? "") : "";
                    const nextStatus = data && typeof data.status === "string" ? data.status : null;
                    return result.ok
                      ? {
                          ok: true,
                          message: `Certified files released${email ? `. Email ${email}` : ""}.`,
                          status: nextStatus,
                        }
                      : { ok: false, error: result.error };
                  });
                }}
                className="inline-flex h-9 items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 text-sm font-semibold disabled:opacity-60"
              >
                {approveButtonLabel(pending)}
              </button>
              </>
            ) : (
              <MissingEvaluationReports reports={reports} />
            )}
            {detail.payment && detail.payment.status !== "refunded" ? (
              <button
                type="button"
                data-testid="refund-open"
                disabled={pending !== null}
                onClick={() => setConfirmRefund(true)}
                className="inline-flex h-9 items-center rounded-[var(--cp-radius)] border border-[#f3c7c7] bg-white px-3 text-sm font-semibold text-[#9b1c1c] disabled:opacity-60"
              >
                Refund
              </button>
            ) : null}
          </div>
        </div>
        {detail.service &&
        (detail.payment?.status === "paid" ||
          detail.payment?.status === "paid_test" ||
          status === "paid" ||
          status === "approved" ||
          status === "delivered") ? (
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Evaluation stage</span>
            <select
              data-testid="evaluation-status"
              value={detail.evaluationStatus ?? ""}
              disabled={pending !== null}
              onChange={(event) => {
                const next = event.target.value;
                if (!next || next === detail.evaluationStatus) return;
                void run("evaluation-status", async () => {
                  const result = await setEvaluationStatus(detail.id, next);
                  return result.ok
                    ? { ok: true, message: "Evaluation stage saved. The customer was emailed." }
                    : { ok: false, error: result.error };
                });
              }}
              className="h-9 rounded-[var(--cp-radius)] border border-line bg-white px-2"
            >
              <option value="">Choose a stage</option>
              <option value="under_review">Under review</option>
              <option value="performing_evaluation">Performing evaluation</option>
              <option value="performing_layout">Performing layout</option>
              <option value="evaluation_complete">Evaluation complete</option>
            </select>
          </label>
        ) : null}
        {status === "approved" || status === "delivered" ? <StaffFiles orderId={detail.id} /> : null}
        <NeedsReviewBanner
          status={status}
          reviewReason={detail.reviewReason}
          deliveryStatus={detail.delivery?.status ?? null}
        />
        {detail.edge ? <EdgeReference edge={detail.edge} /> : null}
        {message ? (
          <p role="status" data-testid="studio-status" className="mt-3 text-sm text-[var(--cp-ok)]">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="studio-error" className="mt-3 text-sm text-[#b45309]">
            {error}
          </p>
        ) : null}
      </div>

      <EvaluationReportBoxes
        reports={reports}
        pending={pending}
        onReject={(message) => {
          setError(message);
          setMessage(null);
        }}
        onUpload={uploadReport}
      />

      <FulfillmentTasks
        key={detail.id}
        orderId={detail.id}
        fulfillment={detail.fulfillment}
        onMessage={setMessage}
        onError={setError}
        pending={pending}
        setPending={setPending}
      />

      <OrderFulfillment key={detail.id} orderId={detail.id} />

      {awaitingEquivalencyPublish(detail.reviewReason) ? (
        <form
          className="grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run("equivalency", async () => {
              const result = await assignEquivalency(detail.id, {
                equivalencies: equivalencies.map((item) => item.usEquivalency),
                countries: equivalencies.map((item) => item.country),
                fields: equivalencies.map((item) => item.field),
                dates: equivalencies.map((item) => item.dates),
              });
              return result.ok
                ? { ok: true, message: "Equivalency saved. The clean report is ready for approval." }
                : { ok: false, error: result.error };
            });
          }}
        >
          <p className="text-sm font-semibold">U.S. equivalency</p>
          <p className="text-sm text-ink-muted">
            {detail.reviewReason === EQUIVALENCY_QA_REVIEW
              ? "Confirm the suggested U.S. equivalency before the clean report can be released."
              : "Set each credential before the clean report can be released."}
          </p>
          {equivalencies.map((value, index) => {
            const credential = detail.equivalencyCredentials[index];
            const patch = (key: "usEquivalency" | "country" | "field" | "dates", nextValue: string) => {
              const next = equivalencies.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [key]: nextValue } : item,
              );
              setEquivalencies(next);
            };
            return (
              <fieldset key={`${credential?.credential ?? "degree"}-${index}`} className="grid gap-2">
                <legend className="text-sm">
                  {credential ? credential.credential : `Degree ${index + 1}`}
                </legend>
                {credential?.basis ? <p className="text-sm text-ink-muted">{credential.basis}</p> : null}
                {(
                  [
                    ["usEquivalency", "U.S. equivalency", "Bachelor's degree"],
                    ["country", "Country", "Mexico"],
                    ["field", "Field", "Administración de Empresas"],
                    ["dates", "Dates", "18 de junio de 2019"],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <label key={key} className="grid gap-1 text-sm">
                    {label}
                    <input
                      value={value[key]}
                      onChange={(event) => patch(key, event.target.value)}
                      placeholder={placeholder}
                      className="h-9 rounded-[var(--cp-radius)] border border-line px-2"
                    />
                  </label>
                ))}
              </fieldset>
            );
          })}
          <button
            type="submit"
            disabled={pending !== null}
            className="h-9 justify-self-start rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending === "equivalency" ? "Saving…" : "Save equivalency"}
          </button>
        </form>
      ) : null}

      {detail.status === "needs_review" ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run("resolve", async () => {
              const result = await resolveReview(detail.id, language.trim());
              return result.ok ? { ok: true, message: "Review resolved. The order is quoted." } : { ok: false, error: result.error };
            });
          }}
        >
          <label className="grid gap-1 text-sm">
            Source language
            <input
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="es"
              className="h-9 w-28 rounded-[var(--cp-radius)] border border-line px-2 font-mono"
            />
          </label>
          <button
            type="submit"
            data-testid="resolve-review"
            disabled={pending !== null}
            className="inline-flex h-9 items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending === "resolve" ? "Resolving…" : "Resolve review"}
          </button>
        </form>
      ) : null}

      {preview ? (
        <div className="h-[720px] overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
          <SideBySideViewer order={preview} chrome="staff" focusPage={focusPage} />
        </div>
      ) : (
        <p className="rounded-[var(--cp-radius)] border border-line bg-white px-4 py-3 text-sm text-ink-muted">
          The files are stored for staff. This order response does not include signed PDF links, so the side-by-side viewer stays closed. Edit the translation text below.
        </p>
      )}

      {detail.qa ? (
        <QaPanel
          qa={detail.qa}
          onJump={(page) => {
            focusNonce.current += 1;
            setFocusPage({ page, nonce: focusNonce.current });
          }}
        />
      ) : null}

      <section data-testid="page-editor" className="grid gap-3">
        <h2 className="text-lg font-semibold">Translation text</h2>
        {detail.pages.length === 0 ? (
          <p className="text-sm text-ink-muted">This order has no page text yet.</p>
        ) : (
          detail.pages.map((page) => (
            <article key={page.id} className="grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4 md:grid-cols-2">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">Page {page.pageNumber} source</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{sourceTextForDisplay(page.sourceText) || "No source text"}</p>
              </div>
              <div className="grid gap-2">
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">Translation</p>
                {(drafts[page.id] ?? [""]).map((paragraph, index) => (
                  <textarea
                    key={`${page.id}-${index}`}
                    aria-label={`Translation page ${page.pageNumber} segment ${index + 1}`}
                    value={paragraph}
                    disabled={!canEdit}
                    onChange={(event) => updateParagraph(page.id, index, event.target.value)}
                    rows={3}
                    className="w-full rounded-[var(--cp-radius)] border border-line px-3 py-2 text-sm outline-none focus:border-primary disabled:bg-[#f6f7f9]"
                  />
                ))}
                {canEdit ? (
                  <button
                    type="button"
                    className="justify-self-start text-sm font-semibold text-primary"
                    onClick={() =>
                      setDrafts((current) => ({ ...current, [page.id]: [...(current[page.id] ?? []), ""] }))
                    }
                  >
                    Add segment
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Customer corrections</h2>
          {detail.corrections.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No correction requests.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {detail.corrections.map((correction) => (
                <li key={correction.id} className="text-sm">
                  <p className="font-semibold">
                    {correction.pageNumber ? `Page ${correction.pageNumber}` : "Order"} · {correction.status}
                  </p>
                  {correction.passage ? <p className="mt-1 text-ink-muted">“{correction.passage}”</p> : null}
                  <p className="mt-1">{correction.note}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section data-testid="notes-thread" className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Internal notes</h2>
          {notesError ? <p className="mt-2 text-sm text-[#b45309]">{notesError}</p> : null}
          <ul className="mt-3 grid gap-3">
            {thread.map((item) => (
              <li key={item.id} className="text-sm">
                <p>{item.body}</p>
                <p className="mt-1 text-xs text-ink-muted">{formatOrderDate(item.createdAt)}</p>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = note.trim();
              if (!body) return;
              void run("note", async () => {
                const result = await addNote(detail.id, body);
                if (!result.ok) return { ok: false, error: result.error };
                setThread((current) => [...current, result.data]);
                setNote("");
                return { ok: true, message: "Note added." };
              });
            }}
          >
            <label className="grid gap-1 text-sm">
              Add a note
              <textarea
                data-testid="note-body"
                value={note}
                maxLength={4000}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="w-full rounded-[var(--cp-radius)] border border-line px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <button
              type="submit"
              data-testid="note-submit"
              disabled={pending !== null || note.trim().length === 0}
              className="inline-flex h-9 items-center justify-center rounded-[var(--cp-radius)] border border-line text-sm font-semibold disabled:opacity-60"
            >
              {pending === "note" ? "Saving…" : "Add note"}
            </button>
          </form>
        </section>
        <section data-testid="activity-log" className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Activity</h2>
          <ol className="mt-3 grid gap-3">
            {activity.map((item) => (
              <li key={item.id} className="text-sm">
                <p>{item.label}</p>
                <p className="text-xs text-ink-muted">{formatOrderDate(item.at)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {confirmRefund ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0b1220]/40 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="refund-title" className="w-full max-w-md rounded-[var(--cp-radius)] bg-white p-5">
            <h2 id="refund-title" className="text-lg font-semibold">
              Refund this order?
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              The payment is marked refunded and the customer can no longer download the certified files.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="h-9 px-3 text-sm font-semibold" onClick={() => setConfirmRefund(false)}>
                Cancel
              </button>
              <button
                type="button"
                data-testid="refund-confirm"
                className="inline-flex h-9 items-center rounded-[var(--cp-radius)] bg-[#9b1c1c] px-3 text-sm font-semibold text-white"
                onClick={() => {
                  setConfirmRefund(false);
                  void run("refund", async () => {
                    const result = await refundOrder(detail.id);
                    return result.ok
                      ? {
                          ok: true,
                          message: result.data.duplicate ? "This order was already refunded." : "Payment marked refunded.",
                        }
                      : { ok: false, error: result.error };
                  });
                }}
              >
                Refund
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FulfillmentTasks({
  orderId,
  fulfillment,
  onMessage,
  onError,
  pending,
  setPending,
}: {
  orderId: string;
  fulfillment: StaffDetail["fulfillment"];
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
  pending: string | null;
  setPending: (action: string | null) => void;
}) {
  const [mail, setMail] = useState(fulfillment.mail);
  const [notarization, setNotarization] = useState(fulfillment.notarization);
  const [tracking, setTracking] = useState(fulfillment.mail?.trackingNumber ?? "");
  if (!mail && !notarization) return null;

  async function markShipped() {
    const trackingNumber = tracking.trim();
    if (!trackingNumber) {
      onError("Tracking number is required");
      onMessage(null);
      return;
    }
    setPending("ship");
    onError(null);
    onMessage(null);
    const result = await shipOrder(orderId, trackingNumber);
    setPending(null);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setMail({
      status: "shipped",
      trackingNumber: result.data.trackingNumber,
      carrier: mail?.carrier ?? null,
      shippedAt: mail?.shippedAt ?? null,
      address: mail?.address ?? null,
    });
    onMessage(`Marked shipped. Tracking ${result.data.trackingNumber}.`);
  }

  async function markNotarized() {
    setPending("notarize");
    onError(null);
    onMessage(null);
    const result = await notarizeOrder(orderId);
    setPending(null);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    setNotarization({ status: "done" });
    onMessage(result.data.duplicate ? "Notarization was already marked done." : "Notarization marked done.");
  }

  return (
    <section data-testid="fulfillment" className="grid gap-3 md:grid-cols-2">
      {mail ? (
        <form
          data-testid="fulfillment-mail"
          className="grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void markShipped();
          }}
        >
          <h2 className="text-sm font-semibold">Mailing</h2>
          {mail.address ? (
            <p className="text-sm text-ink-muted">
              {mail.address.name}
              <br />
              {mail.address.line1}
              {mail.address.line2 ? (
                <>
                  <br />
                  {mail.address.line2}
                </>
              ) : null}
              <br />
              {mail.address.city}, {mail.address.state} {mail.address.postalCode}
              <br />
              {mail.address.country}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">No shipping address on this order.</p>
          )}
          <p className="text-sm">{mail.status === "shipped" ? `Shipped · ${mail.trackingNumber ?? ""}` : "Pending"}</p>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Tracking number</span>
            <input
              data-testid="tracking-number"
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              className="h-9 rounded-[var(--cp-radius)] border border-line px-2"
            />
          </label>
          <button
            type="submit"
            data-testid="mark-shipped"
            disabled={pending !== null}
            className="inline-flex h-9 w-fit items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending === "ship" ? "Saving…" : mail.status === "shipped" ? "Update tracking" : "Mark shipped"}
          </button>
        </form>
      ) : null}
      {notarization ? (
        <div
          data-testid="fulfillment-notarization"
          className="grid content-start gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
        >
          <h2 className="text-sm font-semibold">Notarization</h2>
          <p className="text-sm">
            {notarization.status === "done" ? "Done" : notarization.status === "notarized" ? "Notarized" : "Pending"}
          </p>
          {notarization.status !== "done" ? (
            <button
              type="button"
              data-testid="mark-notarized"
              disabled={pending !== null}
              onClick={() => void markNotarized()}
              className="inline-flex h-9 w-fit items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending === "notarize" ? "Saving…" : "Mark done"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function staffPreview(detail: StaffDetail): PreviewOrder | null {
  if (!detail.originalUrl || !detail.translationUrl) return null;
  const count = Math.max(detail.pages.length, detail.billablePages ?? 1, 1);
  const pages = letterPages(count);
  return {
    id: detail.id,
    status: "preview_ready",
    sourceLanguage: detail.sourceLanguage ? languageLabel(detail.sourceLanguage) : "Unknown",
    targetLanguage: languageLabel(detail.targetLanguage),
    filename: detail.filename,
    pageCount: count,
    original: { url: detail.originalUrl, subtitle: "Original", pages },
    translation: { url: detail.translationUrl, subtitle: "Translation", pages },
    pricing: {
      perPageCents: 995,
      pages: count,
      certificationIncluded: true,
      totalCents: detail.totalCents ?? count * 995,
    },
    included: [],
    corrections: [],
  };
}

function letterPages(count: number): PreviewPageSize[] {
  return Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    widthPt: 612,
    heightPt: 792,
  }));
}
