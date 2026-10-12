"use client";

import { useRouter } from "next/navigation";
import { FlowHeader } from "./flow-header";
import { UploadCard } from "./upload-card";
import { useFlowDraft } from "./use-flow-draft";

export function UploadView() {
  const router = useRouter();
  const { draft, quote, save } = useFlowDraft();

  return (
    <div>
      <FlowHeader current="upload" />
      <main className="mx-auto w-full max-w-[560px] px-4 py-10 md:py-16">
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          Upload your documents
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          PDF or phone photos. We’ll price every page before you pay.
        </p>
        <UploadCard
          email={draft.email}
          files={quote.files}
          onEmail={(email) => save({ email })}
          onSubmit={() => router.push("/quote")}
        />
      </main>
    </div>
  );
}
