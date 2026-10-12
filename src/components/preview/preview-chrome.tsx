"use client";

import type { FormEvent } from "react";
import {
  buyLabel,
  formatMoney,
  type PreviewCorrection,
  type PreviewOrder,
} from "./preview-order";

export function OrderRail({
  order,
  corrections,
  onBuy,
}: {
  order: PreviewOrder;
  corrections: PreviewCorrection[];
  onBuy?: () => void;
}) {
  const { pricing } = order;

  return (
    <div data-testid="order-rail" className="flex h-full flex-col gap-[18px]">
      <div>
        <p className="preview-kicker mb-2">Your translation is ready</p>
        <h2 className="text-xl tracking-[-0.3px]">Review every page, then buy.</h2>
      </div>
      <p className="text-[13.5px] leading-normal text-ink-muted">
        Check names, dates and numbers against your original. Corrections are
        free and come back as a new preview.
      </p>
      <div className="rounded-[var(--cp-radius)] border border-line text-sm">
        <div className="flex justify-between px-3.5 py-[11px]">
          <span>
            {pricing.pages} pages × {formatMoney(pricing.perPageCents)}
          </span>
          <span>{formatMoney(pricing.totalCents)}</span>
        </div>
        <div className="flex justify-between border-t border-line px-3.5 py-[11px]">
          <span>Certification</span>
          <span>{pricing.certificationIncluded ? "Included" : "Extra"}</span>
        </div>
        <div className="flex justify-between border-t border-line px-3.5 py-[11px] text-base font-bold">
          <span>Total</span>
          <span>{formatMoney(pricing.totalCents)}</span>
        </div>
      </div>
      <button
        type="button"
        data-testid="buy-download"
        onClick={onBuy}
        className="inline-flex h-[52px] w-full items-center justify-center rounded-[var(--cp-radius)] bg-primary text-base font-semibold text-primary-ink"
      >
        {buyLabel(order)}
      </button>
      <ul className="grid gap-[7px] text-[13px] text-ink-muted">
        {order.included.map((item) => (
          <li key={item}>
            <span className="mr-2 font-bold text-[var(--cp-ok)]">✓</span>
            {item}
          </li>
        ))}
      </ul>
      <div className="border-t border-line pt-4">
        <p className="preview-kicker mb-2.5">Corrections ({corrections.length})</p>
        {corrections.length === 0 ? (
          <p className="text-[13px] text-ink-muted">None yet.</p>
        ) : (
          <ul>
            {corrections.map((correction) => (
              <li
                key={correction.id}
                className="flex gap-2.5 py-2 text-[13px]"
              >
                <span className="preview-kicker min-w-[34px] normal-case tracking-normal">
                  P.{correction.page}
                </span>
                <span>
                  <span className="font-semibold">{correction.label}</span>
                  {" · "}
                  {correction.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-auto flex gap-2 text-xs leading-snug text-ink-muted">
        <span aria-hidden>🔒</span>
        <span>
          The clean file and certificate unlock only after payment. This
          preview link is private to your email.
        </span>
      </p>
    </div>
  );
}

export function MobileBuyBar({
  order,
  onFlag,
  onBuy,
}: {
  order: PreviewOrder;
  onFlag: () => void;
  onBuy?: () => void;
}) {
  return (
    <div
      data-testid="mobile-buy-bar"
      className="flex flex-col gap-2 border-t border-line bg-bg px-4 pt-3 pb-6"
    >
      <div className="flex items-center justify-between text-[13px] text-ink-muted">
        <button type="button" data-testid="flag-correction" onClick={onFlag}>
          ⚑ Flag a correction
        </button>
        <span>
          {order.pageCount} pages · certified
        </span>
      </div>
      <button
        type="button"
        data-testid="buy-download"
        onClick={onBuy}
        className="inline-flex h-[50px] w-full items-center justify-center rounded-[var(--cp-radius)] bg-primary text-[15px] font-semibold text-primary-ink"
      >
        {buyLabel(order)}
      </button>
    </div>
  );
}

export function CorrectionPopover({
  page,
  note,
  onNote,
  onSend,
  error,
}: {
  page: number;
  note: string;
  onNote: (value: string) => void;
  onSend: () => void;
  error?: string | null;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSend();
  }

  return (
    <form
      data-testid="correction-popover"
      onSubmit={submit}
      className="w-[270px] max-w-full rounded-[var(--cp-radius)] border border-line bg-bg p-3 shadow-[0_12px_32px_-12px_rgba(11,18,32,0.35)]"
    >
      <p className="preview-kicker mb-2">Correction · page {page}</p>
      <p className="mb-2 border-l-2 border-[#e2a400] pl-2 text-xs leading-snug text-ink-muted">
        This page is drawn as an image, so the note is tied to the page rather
        than a selected passage.
      </p>
      <textarea
        data-testid="correction-note"
        value={note}
        onChange={(event) => onNote(event.target.value)}
        rows={3}
        placeholder="What should it say?"
        className="h-[52px] w-full resize-none rounded-[var(--cp-radius)] border border-line p-2 text-[12.5px] text-ink outline-none"
      />
      {error ? (
        <p data-testid="correction-error" role="alert" className="mt-2 text-xs text-[var(--cp-warn)]">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">Page {page}</span>
        <button
          type="submit"
          disabled={!note.trim()}
          className="inline-flex h-[30px] items-center rounded-[var(--cp-radius)] bg-primary px-3 text-[12.5px] font-semibold text-primary-ink disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  );
}
