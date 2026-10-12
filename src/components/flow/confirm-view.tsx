"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { DATE_FORMATS, translatedDate } from "@/lib/flow/mock-data";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import type { ConfirmDetails } from "@/lib/flow/types";
import { FlowHeader } from "./flow-header";
import {
  Field,
  FlowColumns,
  Summary,
  SummaryRow,
  buttonClasses,
  fieldClass,
} from "./ui";
import { useFlowDraft } from "./use-flow-draft";

export function ConfirmView() {
  const router = useRouter();
  const { draft, quote, save } = useFlowDraft();
  const details = draft.details;

  function update(patch: Partial<ConfirmDetails>) {
    save({ details: { ...details, ...patch } });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push("/processing");
  }

  return (
    <div>
      <FlowHeader current="confirm" />
      <main>
        <FlowColumns>
          <form id="confirm-form" onSubmit={onSubmit}>
            <h1 className="text-[32px] font-bold tracking-[-0.6px]">
              Confirm the important details.
            </h1>
            <p className="mt-2 mb-6 text-[15px] text-ink-muted">
              We’ll use these exact spellings and dates everywhere they appear.
              Fix anything we read wrong.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name on document" hint="Accents kept as written">
                <input
                  name="fullName"
                  autoComplete="name"
                  value={details.fullName}
                  onChange={(event) => update({ fullName: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field
                label="Date of birth"
                hint={`Shown in the translation as ${translatedDate(details.dateFormat)}`}
              >
                <input
                  name="dateOfBirth"
                  autoComplete="bday"
                  value={details.dateOfBirth}
                  onChange={(event) =>
                    update({ dateOfBirth: event.target.value })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Father">
                <input
                  name="father"
                  value={details.father}
                  onChange={(event) => update({ father: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label="Mother">
                <input
                  name="mother"
                  value={details.mother}
                  onChange={(event) => update({ mother: event.target.value })}
                  className={fieldClass}
                />
              </Field>
              <Field label="Place of birth">
                <input
                  name="placeOfBirth"
                  value={details.placeOfBirth}
                  onChange={(event) =>
                    update({ placeOfBirth: event.target.value })
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label="Date format">
                <span className="relative block">
                  <select
                    name="dateFormat"
                    value={details.dateFormat}
                    onChange={(event) =>
                      update({ dateFormat: event.target.value })
                    }
                    className={`${fieldClass} appearance-none pr-8`}
                  >
                    {DATE_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                  <span
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
                    aria-hidden
                  >
                    ▾
                  </span>
                </span>
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Anything else we should know?" optional>
                <textarea
                  name="notes"
                  value={details.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                  placeholder='e.g. "Use the spelling on my passport"'
                  className={`${fieldClass} h-16 resize-none py-3 placeholder:text-ink-muted`}
                />
              </Field>
            </div>
          </form>
          <div>
            <Summary>
              <SummaryRow
                label={`${draft.sourceLanguage} → ${draft.targetLanguage}`}
                value={pageLabel(quote.pages)}
              />
              <SummaryRow
                testId="quote-total"
                label="Total if you buy"
                value={formatMoney(quote.totalCents)}
                emphasize
              />
            </Summary>
            <button
              type="submit"
              form="confirm-form"
              data-testid="start-preview"
              className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px]")}
            >
              Start my free preview
            </button>
            <p className="mt-3 text-[12.5px] leading-normal text-ink-muted">
              We’ll email <b className="text-ink">{draft.email}</b> when it’s
              ready. You can close this tab.
            </p>
          </div>
        </FlowColumns>
      </main>
    </div>
  );
}
