"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WaitingBadge } from "@/components/admin/waiting-badge";
import { humanStatus } from "@/components/admin/orders-board";
import { formatOrderMoney } from "@/lib/account/present";
import { uploadFinishedEvaluation } from "@/lib/api/mutations";
import type { StaffDetail } from "@/lib/api/types";
import { pageLabel } from "@/lib/flow/pricing";

function done(detail: StaffDetail): boolean {
  return (
    detail.status === "delivered" ||
    detail.status === "approved" ||
    detail.delivery?.status === "delivered" ||
    detail.delivery?.status === "approved"
  );
}

export function EvaluationDelivery({ detail }: { detail: StaffDetail }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(done(detail));
  const originals = detail.originals.length > 0
    ? detail.originals
    : detail.originalUrl
      ? [{ filename: detail.filename, url: detail.originalUrl, pages: detail.billablePages }]
      : [];

  async function upload() {
    if (!file) {
      setError("Choose the finished evaluation PDF.");
      return;
    }
    const namedPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!namedPdf || file.size <= 0) {
      setError("Upload a PDF.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await uploadFinishedEvaluation(detail.id, file);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setUploaded(true);
    router.refresh();
  }

  return (
    <div data-testid="evaluation-delivery" className="mx-auto grid max-w-3xl gap-6">
      <div>
        <Link href="/admin/evaluations" className="text-sm font-semibold text-primary">
          Evaluations
        </Link>
        <h1 className="mt-2 text-[26px] tracking-[-0.6px]">Order {detail.id}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {detail.email ?? "No email"} · {humanStatus(detail.status)} · {formatOrderMoney(detail.totalCents)}
        </p>
        {uploaded ? null : (
          <div className="mt-3">
            <WaitingBadge paidAt={detail.payment?.paidAt ?? null} createdAt={detail.createdAt} />
          </div>
        )}
      </div>

      <section className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Customer originals</h2>
        {originals.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No original files are on this order.</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {originals.map((item) => (
              <li key={`${item.filename}-${item.url ?? "file"}`} className="text-sm">
                {item.url ? (
                  <a href={item.url} className="font-semibold text-primary" target="_blank" rel="noreferrer">
                    {item.filename}
                  </a>
                ) : (
                  <span className="font-semibold">{item.filename}</span>
                )}
                {item.pages != null ? (
                  <span className="text-ink-muted"> · {pageLabel(item.pages)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
        <h2 className="text-sm font-semibold">Finished evaluation</h2>
        {uploaded ? (
          <p data-testid="evaluation-uploaded" className="mt-2 text-sm text-ink-muted">
            Uploaded. The customer can download it now.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-muted">
              Upload the finished evaluation PDF. Saving it marks the order done and emails the customer.
            </p>
            <label className="mt-4 block text-sm font-semibold">
              PDF
              <input
                data-testid="evaluation-file"
                type="file"
                accept="application/pdf,.pdf"
                className="mt-1 block w-full text-sm font-normal"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-[#9b1c1c]">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="upload-evaluation"
              disabled={pending}
              onClick={() => void upload()}
              className="mt-4 h-11 rounded-[var(--cp-radius)] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Uploading…" : "Upload finished evaluation"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
