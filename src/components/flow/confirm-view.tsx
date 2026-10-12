"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { pageLabel } from "@/lib/flow/pricing";
import {
  customerEmail,
  joinParents,
  languageLine,
  splitParents,
  totalLabel,
} from "@/lib/flow/present";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredToken } from "./use-order";
import {
  Field,
  FlowColumns,
  Summary,
  SummaryRow,
  buttonClasses,
  fieldClass,
} from "./ui";

const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY"] as const;

type DocFields = {
  full_name: string;
  date_of_birth: string;
  father: string;
  mother: string;
  place_of_birth: string;
  date_format: string;
};

export function ConfirmView({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const { order, error, loading } = useCustomerOrder(token, "once");

  return (
    <div>
      <FlowHeader current="confirm" />
      <main>
        {loading && !order ? (
          <FlowStatus title="Loading the details…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order || order.status !== "quoted" ? (
          <FlowStatus
            title="These details aren't ready to confirm"
            body={
              order?.status === "needs_review"
                ? "We'll confirm the language before you review names and dates."
                : "Open your quote first."
            }
          />
        ) : (
          <ConfirmForm token={token} order={order} />
        )}
      </main>
    </div>
  );
}

function valueOf(order: CustomerOrder, documentId: string, key: string) {
  const row = order.confirmations.find(
    (field) => field.documentId === documentId && field.fieldKey === key,
  );
  return row?.confirmedValue ?? row?.originalValue ?? "";
}

function ConfirmForm({ token, order }: { token: string; order: CustomerOrder }) {
  const router = useRouter();
  const params = useSearchParams();
  const email = customerEmail(order);
  const multiple = order.documents.length > 1;
  const language = params.get("lang") || order.sourceLanguage || "es";
  const [docs, setDocs] = useState<Record<string, DocFields>>(() => {
    const initial: Record<string, DocFields> = {};
    for (const document of order.documents) {
      const parents = splitParents(valueOf(order, document.id, "parent_names"));
      initial[document.id] = {
        full_name: valueOf(order, document.id, "full_name"),
        date_of_birth: valueOf(order, document.id, "date_of_birth"),
        father: parents.father,
        mother: parents.mother,
        place_of_birth: valueOf(order, document.id, "place_of_birth"),
        date_format: valueOf(order, document.id, "date_format") || "MM/DD/YYYY",
      };
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(documentId: string, patch: Partial<DocFields>) {
    setDocs((current) => ({
      ...current,
      [documentId]: { ...current[documentId], ...patch },
    }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await getFlowClient().confirm(token, {
        sourceLanguage: language,
        documents: order.documents.map((document) => {
          const fields = docs[document.id];
          return {
            documentId: document.id,
            full_name: fields?.full_name ?? "",
            date_of_birth: fields?.date_of_birth ?? "",
            parent_names: joinParents(fields?.father ?? "", fields?.mother ?? ""),
            place_of_birth: fields?.place_of_birth ?? "",
            date_format: fields?.date_format || "MM/DD/YYYY",
          };
        }),
      });
      router.push("/processing");
    } catch (cause) {
      setError(cause instanceof FlowApiError ? cause.message : "Could not start the preview.");
    } finally {
      setPending(false);
    }
  }

  function nameFor(documentName: string, label: string) {
    return multiple ? `${label} · ${documentName}` : label;
  }

  return (
    <FlowColumns>
      <form id="confirm-form" onSubmit={onSubmit}>
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          Confirm the important details.
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          We’ll use these exact spellings and dates everywhere they appear. Fix anything
          we read wrong.
        </p>
        <input type="hidden" name="sourceLanguage" value={language} />
        {order.documents.map((document) => {
          const fields = docs[document.id];
          if (!fields) return null;
          return (
            <fieldset key={document.id} className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">{document.filename}</legend>
              <Field label={nameFor(document.filename, "Full name on document")} hint="Accents kept as written">
                <input
                  aria-label={nameFor(document.filename, "Full name on document")}
                  value={fields.full_name}
                  onChange={(event) => update(document.id, { full_name: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field
                label={nameFor(document.filename, "Date of birth")}
                hint={`Dates in the translation use ${fields.date_format}`}
              >
                <input
                  aria-label={nameFor(document.filename, "Date of birth")}
                  value={fields.date_of_birth}
                  onChange={(event) =>
                    update(document.id, { date_of_birth: event.target.value })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={nameFor(document.filename, "Father")}>
                <input
                  aria-label={nameFor(document.filename, "Father")}
                  value={fields.father}
                  onChange={(event) => update(document.id, { father: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label={nameFor(document.filename, "Mother")}>
                <input
                  aria-label={nameFor(document.filename, "Mother")}
                  value={fields.mother}
                  onChange={(event) => update(document.id, { mother: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label={nameFor(document.filename, "Place of birth")}>
                <input
                  aria-label={nameFor(document.filename, "Place of birth")}
                  value={fields.place_of_birth}
                  onChange={(event) =>
                    update(document.id, { place_of_birth: event.target.value })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={nameFor(document.filename, "Date format")}>
                <select
                  aria-label={nameFor(document.filename, "Date format")}
                  value={fields.date_format}
                  onChange={(event) =>
                    update(document.id, { date_format: event.target.value })
                  }
                  className={fieldClass}
                >
                  {DATE_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format}
                    </option>
                  ))}
                </select>
              </Field>
            </fieldset>
          );
        })}
        {error ? (
          <p role="alert" className="text-sm text-[var(--cp-warn)]">
            {error}
          </p>
        ) : null}
      </form>
      <div>
        <Summary>
          <SummaryRow
            label={languageLine({ ...order, sourceLanguage: language })}
            value={pageLabel(order.billablePages ?? 0)}
          />
          <SummaryRow
            testId="quote-total"
            label="Total if you buy"
            value={totalLabel(order.totalCents)}
            emphasize
          />
        </Summary>
        <button
          type="submit"
          form="confirm-form"
          data-testid="start-preview"
          disabled={pending}
          className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px] disabled:opacity-60")}
        >
          {pending ? "Starting…" : "Start my free preview"}
        </button>
        <p className="mt-3 text-[12.5px] leading-normal text-ink-muted">
          We’ll email {email ? <b className="text-ink">{email}</b> : "you"} when it’s ready.
          You can close this tab.
        </p>
      </div>
    </FlowColumns>
  );
}
