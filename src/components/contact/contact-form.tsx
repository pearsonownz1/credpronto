"use client";

import { useState, type FormEvent } from "react";
import { buttonClasses } from "@/components/flow/ui";
import {
  CONTACT_TO,
  validateContact,
  type ContactField,
  type ContactFieldErrors,
} from "@/lib/contact/validate";

const INITIAL = {
  name: "",
  email: "",
  company: "",
  orderNumber: "",
  message: "",
  website: "",
};

type Fields = typeof INITIAL;

const inputClass =
  "h-11 w-full rounded-[4px] border border-[#D5DBE7] bg-white px-3 text-[15px] text-ink outline-none focus:border-[#1F5EFF]";

export function ContactForm() {
  const [fields, setFields] = useState<Fields>(INITIAL);
  const [errors, setErrors] = useState<ContactFieldErrors>({});
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [failed, setFailed] = useState(false);

  function update(key: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    if (key !== "website") {
      setErrors((current) => {
        if (!current[key as ContactField]) return current;
        const next = { ...current };
        delete next[key as ContactField];
        return next;
      });
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    const parsed = validateContact(fields);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    if (parsed.honeypot) {
      setSucceeded(true);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: parsed.value.name,
          email: parsed.value.email,
          ...(parsed.value.company ? { company: parsed.value.company } : {}),
          ...(parsed.value.orderNumber ? { orderNumber: parsed.value.orderNumber } : {}),
          message: parsed.value.message,
          ...(fields.website.trim() ? { website: fields.website } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        errors?: ContactFieldErrors;
      } | null;
      if (body?.errors) {
        setErrors(body.errors);
        return;
      }
      if (!response.ok || !body?.ok) {
        setFailed(true);
        return;
      }
      setSucceeded(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (succeeded) {
    return (
      <p data-testid="contact-success" role="status" className="text-[17px] leading-relaxed text-ink">
        Thanks, we got your message and will reply by email.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative grid gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          id="contact-name"
          label="Name"
          required
          value={fields.name}
          error={errors.name}
          autoComplete="name"
          onChange={(value) => update("name", value)}
        />
        <Field
          id="contact-email"
          label="Email"
          required
          type="email"
          value={fields.email}
          error={errors.email}
          autoComplete="email"
          onChange={(value) => update("email", value)}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          id="contact-company"
          label="Company"
          optional
          value={fields.company}
          error={errors.company}
          autoComplete="organization"
          onChange={(value) => update("company", value)}
        />
        <Field
          id="contact-order"
          label="Order number"
          optional
          value={fields.orderNumber}
          error={errors.orderNumber}
          onChange={(value) => update("orderNumber", value)}
        />
      </div>
      <label className="block" htmlFor="contact-message">
        <FieldLabel required>How can we help?</FieldLabel>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={6}
          value={fields.message}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          onChange={(event) => update("message", event.target.value)}
          className={`${inputClass} h-auto min-h-32 py-3 ${errors.message ? "border-[#E53E3E]" : ""}`}
        />
        {errors.message ? <FieldError id="contact-message-error">{errors.message}</FieldError> : null}
      </label>
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Website
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={fields.website}
            onChange={(event) => update("website", event.target.value)}
          />
        </label>
      </div>
      {failed ? (
        <p data-testid="contact-error" role="alert" className="text-sm leading-relaxed text-[#E53E3E]">
          We couldn&apos;t send your message. Email{" "}
          <a className="font-semibold underline" href={`mailto:${CONTACT_TO}`}>
            {CONTACT_TO}
          </a>
          .
        </p>
      ) : null}
      <div>
        <button
          type="submit"
          data-testid="contact-submit"
          disabled={pending}
          className={buttonClasses("primary", "h-12 px-6 text-[15px] disabled:cursor-wait disabled:opacity-70")}
        >
          {pending ? "Sending…" : "Send message →"}
        </button>
      </div>
    </form>
  );
}

function FieldLabel({
  required,
  children,
}: {
  required?: boolean;
  children: string;
}) {
  return (
    <span className="mb-1.5 block text-[13px] font-semibold">
      {children}
      {required ? <span className="text-[#E53E3E]"> *</span> : null}
    </span>
  );
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} className="mt-1.5 block text-[13px] text-[#E53E3E]">
      {children}
    </span>
  );
}

function Field({
  id,
  label,
  required,
  optional,
  type = "text",
  value,
  error,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  type?: string;
  value: string;
  error?: string;
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-[13px] font-semibold">
        {label}
        {required ? <span className="text-[#E53E3E]"> *</span> : null}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} ${error ? "border-[#E53E3E]" : ""}`}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </label>
  );
}
