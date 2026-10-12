"use client";

import type { FormEvent } from "react";
import { pageLabel } from "@/lib/flow/pricing";
import type { PricedFile } from "@/lib/flow/types";
import { buttonClasses, fieldClass } from "./ui";

export function UploadCard({
  email,
  files,
  onEmail,
  onSubmit,
  intro,
}: {
  email: string;
  files: PricedFile[];
  onEmail: (email: string) => void;
  onSubmit: () => void;
  intro?: { title: string; lede: string };
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="flow-card-shadow rounded-[var(--cp-radius)] border border-line bg-bg p-5 md:p-[26px]">
      {intro ? (
        <>
          <h2 className="text-xl font-bold tracking-[-0.6px]">{intro.title}</h2>
          <p className="mt-1.5 mb-[18px] text-[13.5px] text-ink-muted">
            {intro.lede}
          </p>
        </>
      ) : null}
      <form onSubmit={handleSubmit}>
        <div
          data-testid="upload-drop"
          className="rounded-[var(--cp-radius)] border-[1.5px] border-dashed border-[#b9c3d6] bg-[var(--cp-blue-l)] px-4 py-6 text-center"
        >
          <div className="text-[26px] leading-none text-primary" aria-hidden>
            ⤒
          </div>
          <div className="mt-1.5 font-semibold">
            Drop files or{" "}
            <button type="button" className="cursor-pointer text-primary">
              browse
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            PDF, JPG, PNG, HEIC · several files OK
          </p>
        </div>
        <ul
          data-testid="file-list"
          className="mt-3 overflow-hidden rounded-[var(--cp-radius)] border border-line text-[13.5px]"
        >
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
            >
              <span className="min-w-0 truncate">
                <span aria-hidden>{file.kind === "pdf" ? "📄" : "🖼"} </span>
                {file.name}
              </span>
              <span className="shrink-0 text-ink-muted">
                {pageLabel(file.pages)}
              </span>
            </li>
          ))}
        </ul>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold">
            Email for your preview link
          </span>
          <input
            data-testid="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          data-testid="get-quote"
          className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px]")}
        >
          Get my quote
        </button>
        <p className="mt-2.5 text-center text-xs text-ink-muted">
          <span aria-hidden>🔒 </span>
          Files are private and encrypted. Deleted on request.
        </p>
      </form>
    </div>
  );
}
