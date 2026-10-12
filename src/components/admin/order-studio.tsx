"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { activityFor } from "@/lib/account/activity";
import { formatOrderDate, formatOrderMoney } from "@/lib/account/present";
import { addNote, approveOrder, patchOrderTranslation, refundOrder, regenerateOrder, resolveReview } from "@/lib/api/mutations";
import type { StaffDetail, StaffNote } from "@/lib/api/types";
import { languageLabel } from "@/lib/orders/languages";
import type { PreviewOrder, PreviewPageSize } from "@/components/preview/preview-order";
import { humanStatus } from "@/components/admin/orders-board";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <p className="p-6 text-sm text-ink-muted">Loading documents…</p> },
);

const EDITABLE = new Set(["preview_ready", "correction_requested", "paid", "approved", "delivered"]);

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const preview = useMemo(() => staffPreview(detail), [detail]);
  const activity = activityFor(detail, thread);
  const canEdit = EDITABLE.has(detail.status);

  function updateParagraph(pageId: string, index: number, value: string) {
    setDrafts((current) => {
      const next = [...(current[pageId] ?? [""])];
      next[index] = value;
      return { ...current, [pageId]: next };
    });
  }

  async function run(action: string, task: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setPending(action);
    setError(null);
    setMessage(null);
    const result = await task();
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? "Request failed");
      return;
    }
    if (result.message) setMessage(result.message);
    router.refresh();
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
              {detail.email ?? "No customer email"} · {humanStatus(detail.status)} ·{" "}
              {detail.sourceLanguage ? languageLabel(detail.sourceLanguage) : "Language unset"} →{" "}
              {languageLabel(detail.targetLanguage)} · {formatOrderMoney(detail.totalCents)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
            {detail.status === "paid" || detail.status === "approved" ? (
              <button
                type="button"
                data-testid="approve-order"
                disabled={pending !== null}
                onClick={() =>
                  void run("approve", async () => {
                    const result = await approveOrder(detail.id);
                    const email =
                      result.ok && result.data && typeof result.data === "object" && "email" in result.data
                        ? String((result.data as { email?: unknown }).email ?? "")
                        : "";
                    return result.ok
                      ? { ok: true, message: `Certified files released${email ? `. Email ${email}` : ""}.` }
                      : { ok: false, error: result.error };
                  })
                }
                className="inline-flex h-9 items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 text-sm font-semibold disabled:opacity-60"
              >
                {pending === "approve" ? "Approving…" : "Approve and release"}
              </button>
            ) : null}
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
        {detail.reviewReason ? (
          <p className="mt-3 rounded-[var(--cp-radius)] border border-[#f3d7a1] bg-[#fff8ee] px-3 py-2 text-sm">
            Needs review: {detail.reviewReason}
          </p>
        ) : null}
        {message ? (
          <p role="status" data-testid="studio-status" className="mt-3 text-sm text-[var(--cp-ok)]">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[#b45309]">
            {error}
          </p>
        ) : null}
      </div>

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
          <SideBySideViewer order={preview} chrome="staff" />
        </div>
      ) : (
        <p className="rounded-[var(--cp-radius)] border border-line bg-white px-4 py-3 text-sm text-ink-muted">
          The files are stored for staff. This order response does not include signed PDF links, so the side-by-side viewer stays closed. Edit the translation text below.
        </p>
      )}

      <section data-testid="page-editor" className="grid gap-3">
        <h2 className="text-lg font-semibold">Translation text</h2>
        {detail.pages.length === 0 ? (
          <p className="text-sm text-ink-muted">This order has no page text yet.</p>
        ) : (
          detail.pages.map((page) => (
            <article key={page.id} className="grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4 md:grid-cols-2">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">Page {page.pageNumber} source</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{page.sourceText || "No source text"}</p>
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
