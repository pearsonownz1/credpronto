"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import {
  CONFIRM_DATE_FORMATS,
  defaultDateFormat,
  isConfirmDateFormat,
  storedConfirmation,
} from "@/lib/flow/date-format";
import { writeToken } from "@/lib/flow/session";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import {
  canOpenConfirm,
  isCustomerEvaluation,
  isTranslationBundle,
  joinParents,
  languageLine,
  splitParents,
  totalLabel,
} from "@/lib/flow/present";
import { evaluationServiceDescription } from "@/lib/orders/evaluation-price";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { WrongEmailLink } from "./wrong-email-link";
import { useCustomerOrder, useStoredEmail, useStoredToken } from "./use-order";
import {
  Field,
  FlowColumns,
  Summary,
  SummaryRow,
  buttonClasses,
  fieldClass,
} from "./ui";

type DocFields = {
  full_name: string;
  date_of_birth: string;
  father: string;
  mother: string;
  place_of_birth: string;
  date_format: string;
};

export function ConfirmView({
  token: pathToken,
  accountEmail = null,
}: {
  token?: string;
  accountEmail?: string | null;
}) {
  const params = useSearchParams();
  const token = useStoredToken(pathToken ?? params.get("token"));
  const { order, error, loading } = useCustomerOrder(token, "once");

  useEffect(() => {
    if (token) writeToken(token);
  }, [token]);

  return (
    <div>
      <FlowHeader
        current={order && isTranslationBundle(order) ? "preview" : "confirm"}
        track={
          order && isTranslationBundle(order)
            ? "bundle"
            : order && isCustomerEvaluation(order)
              ? "evaluation"
              : "translation"
        }
      />
      <main>
        {loading && !order ? (
          <FlowStatus title="Loading the details…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : order && isCustomerEvaluation(order) && !isTranslationBundle(order) ? (
          <EvaluationPayRedirect token={token} />
        ) : !order || !canOpenConfirm(order) ? (
          <FlowStatus
            title="These details aren't ready to confirm"
            body={
              order?.status === "needs_review"
                ? "We'll confirm the language before you review names and dates."
                : "Open your quote first."
            }
          />
        ) : (
          <ConfirmForm token={token} order={order} accountEmail={accountEmail} />
        )}
      </main>
    </div>
  );
}

function EvaluationPayRedirect({ token }: { token: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!token) return;
    router.replace(`/checkout?token=${encodeURIComponent(token)}`);
  }, [router, token]);
  return <FlowStatus title="Opening payment…" body="" />;
}

function valueOf(order: CustomerOrder, documentId: string, key: string) {
  const row = order.confirmations.find(
    (field) => field.documentId === documentId && field.fieldKey === key,
  );
  return row?.confirmedValue ?? row?.originalValue ?? "";
}

function dateReading(order: CustomerOrder, documentId: string, key: string) {
  const row = order.confirmations.find(
    (field) => field.documentId === documentId && field.fieldKey === key,
  );
  return storedConfirmation(row?.confirmedValue, row?.originalValue);
}

function ConfirmForm({
  token,
  order,
  accountEmail,
}: {
  token: string;
  order: CustomerOrder;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const storedEmail = useStoredEmail();
  const [signedInEmail, setSignedInEmail] = useState(accountEmail?.trim() || "");
  const email = signedInEmail || storedEmail;
  const multiple = order.documents.length > 1;
  const language = params.get("lang") || order.sourceLanguage || "es";
  const target = params.get("target") || order.targetLanguage;
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
        date_format: defaultDateFormat(
          dateReading(order, document.id, "date_format"),
          dateReading(order, document.id, "date_of_birth"),
        ),
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
            date_format: isConfirmDateFormat(fields?.date_format)
              ? fields.date_format
              : defaultDateFormat(fields?.date_format, fields?.date_of_birth),
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
                  {CONFIRM_DATE_FORMATS.map((format) => (
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
            label={languageLine({ sourceLanguage: language, targetLanguage: target })}
            value={pageLabel(order.billablePages ?? 0)}
          />
          {isTranslationBundle(order) && order.service && order.evaluationCents != null && order.evaluationCents > 0 ? (
            <SummaryRow
              testId="evaluation-price"
              label={evaluationServiceDescription(order.service)}
              value={formatMoney(order.evaluationCents)}
            />
          ) : null}
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
        <div className="mt-3 text-[12.5px] leading-normal text-ink-muted">
          <p>
            We’ll email {email ? <b className="text-ink">{email}</b> : "you"} when it’s ready.
            You can close this tab.
          </p>
          {signedInEmail ? <WrongEmailLink email={signedInEmail} onConfirmed={setSignedInEmail} /> : null}
        </div>
      </div>
    </FlowColumns>
  );
}
