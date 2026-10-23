import { Logo } from "@/components/flow/mark";
import { buttonClasses } from "@/components/flow/ui";
import { FILE_UNAVAILABLE } from "@/lib/verify/present";

export type VerifyScreenModel =
  | { state: "loading" }
  | { state: "error"; onRetry: () => void }
  | { state: "not_found" }
  | {
      state: "revoked";
      typeLabel: string | null;
      issuedOn: string | null;
      reference: string | null;
    }
  | {
      state: "valid";
      typeLabel: string | null;
      issuedOn: string | null;
      reference: string | null;
      viewerUrl: string | null;
      opening: boolean;
      downloading: boolean;
      fileMessage: string | null;
      onDownload: () => void;
      onRetry: () => void;
    };

export function VerifyScreen(model: VerifyScreenModel) {
  return (
    <div className="flex flex-1 flex-col" data-testid="verify-page">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-6">
          <Logo />
        </div>
      </header>
      {model.state === "valid" ? <ValidDocument {...model} /> : <StatusMessage model={model} />}
    </div>
  );
}

function StatusMessage({ model }: { model: Exclude<VerifyScreenModel, { state: "valid" }> }) {
  const copy = statusCopy(model);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="preview-kicker" data-testid={copy.testId}>
        {copy.kicker}
      </p>
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">{copy.title}</h1>
      <p className="mt-3 text-base text-ink-muted">{copy.body}</p>
      {model.state === "revoked" ? <RevokedFacts model={model} /> : null}
      {model.state === "error" ? (
        <button type="button" className={buttonClasses("primary", "mt-6 h-11 px-4")} onClick={model.onRetry}>
          Try again
        </button>
      ) : null}
    </main>
  );
}

function RevokedFacts({ model }: { model: Extract<VerifyScreenModel, { state: "revoked" }> }) {
  const facts = [
    model.typeLabel ? ["Document type", model.typeLabel] : null,
    model.issuedOn ? ["Issued", model.issuedOn] : null,
    model.reference ? ["Reference", model.reference] : null,
  ].filter((fact): fact is [string, string] => fact != null);
  if (facts.length === 0) return null;
  return (
    <dl className="mt-6 grid w-full gap-4 text-left">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className={label === "Reference" ? "preview-mono mt-1 text-sm font-semibold break-all" : "mt-1 font-semibold"}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function statusCopy(model: Exclude<VerifyScreenModel, { state: "valid" }>): {
  kicker: string;
  title: string;
  body: string;
  testId: string;
} {
  if (model.state === "loading") {
    return {
      kicker: "Verification",
      title: "Checking this document",
      body: "Confirming it with CredPronto.",
      testId: "verify-loading",
    };
  }
  if (model.state === "revoked") {
    return {
      kicker: "Revoked",
      title: "This document was revoked",
      body: "CredPronto has revoked this document. It can no longer be verified.",
      testId: "verify-revoked",
    };
  }
  if (model.state === "not_found") {
    return {
      kicker: "Not found",
      title: "No CredPronto document for this link",
      body: "The link is invalid, or the document is not in our records.",
      testId: "verify-not-found",
    };
  }
  return {
    kicker: "Something went wrong",
    title: "We couldn't check this document",
    body: "Try the check again.",
    testId: "verify-error",
  };
}

function ValidDocument({
  typeLabel,
  issuedOn,
  reference,
  viewerUrl,
  opening,
  downloading,
  fileMessage,
  onDownload,
  onRetry,
}: Extract<VerifyScreenModel, { state: "valid" }>) {
  const facts = [
    typeLabel ? ["Document type", typeLabel] : null,
    issuedOn ? ["Issued", issuedOn] : null,
    reference ? ["Reference", reference] : null,
  ].filter((fact): fact is [string, string] => fact != null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 md:px-6">
      <section className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-bg" data-testid="verify-valid">
        <div className="flex flex-col gap-6 border-b border-line p-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="preview-kicker text-[var(--cp-ok)]">Authentic</p>
            <h1 className="mt-2 text-[32px] font-bold tracking-[-0.6px]">Authentic CredPronto document</h1>
            <p className="mt-2 max-w-xl text-base text-ink-muted">This document was issued by CredPronto.</p>
          </div>
          {viewerUrl ? (
            <button
              type="button"
              className={buttonClasses("primary", "h-11 shrink-0 px-4 disabled:cursor-wait disabled:opacity-70")}
              onClick={onDownload}
              disabled={downloading}
              data-testid="document-download"
            >
              {downloading ? "Downloading…" : "Download"}
            </button>
          ) : null}
        </div>
        {facts.length > 0 ? (
          <dl className="grid gap-4 border-b border-line px-6 py-5 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd className={label === "Reference" ? "preview-mono mt-1 text-sm font-semibold break-all" : "mt-1 font-semibold"}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="bg-bg-muted p-4 md:p-6">
          {viewerUrl ? (
            <iframe
              title="CredPronto document"
              src={viewerUrl}
              className="h-[min(80vh,960px)] min-h-[480px] w-full rounded-[var(--cp-radius)] border border-line bg-bg"
              referrerPolicy="no-referrer"
              loading="eager"
              allow="fullscreen"
              data-testid="document-viewer"
            />
          ) : (
            <div className="rounded-[var(--cp-radius)] border border-line bg-bg px-6 py-10 text-center" data-testid="document-unavailable">
              <p className="text-ink-muted">{opening ? "Opening the document…" : (fileMessage ?? FILE_UNAVAILABLE)}</p>
              {opening ? null : (
                <button type="button" className={buttonClasses("primary", "mt-6 h-11 px-4")} onClick={onRetry}>
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export function savePdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.referrerPolicy = "no-referrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function openDocumentUrl(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.download = filename;
  anchor.referrerPolicy = "no-referrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
