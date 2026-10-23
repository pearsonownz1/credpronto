"use client";

import { useState } from "react";
import { downloadOrderFile, listOrderFiles, type StaffOrderFile } from "@/lib/api/mutations";

const KIND_LABEL: Record<string, string> = {
  delivered: "Delivered package",
  diploma: "Diploma evaluation",
  course_by_course: "Course-by-course evaluation",
  translation: "Final translation",
  certification: "Certification",
};

/** Staff download of an order's final files. Each click is logged server-side before the URL is signed. */
export function StaffFiles({ orderId }: { orderId: string }) {
  const [files, setFiles] = useState<StaffOrderFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy("list");
    setError(null);
    const result = await listOrderFiles(orderId);
    setBusy(null);
    if (result.ok) setFiles(result.data.files);
    else setError(result.error);
  }

  async function download(path: string) {
    setBusy(path);
    setError(null);
    const result = await downloadOrderFile(orderId, path);
    setBusy(null);
    if (result.ok) window.location.assign(result.data.url);
    else setError(result.error);
  }

  return (
    <div className="mt-3 text-sm" data-testid="staff-files">
      {files === null ? (
        <button
          type="button"
          data-testid="staff-files-load"
          disabled={busy !== null}
          onClick={() => void load()}
          className="h-9 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-semibold"
        >
          {busy === "list" ? "Loading files…" : "Download files"}
        </button>
      ) : files.length === 0 ? (
        <p className="text-ink-muted">No final files on this order yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Download</span>
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              data-testid={`staff-file-${file.kind}`}
              disabled={busy !== null}
              aria-busy={busy === file.path}
              title={file.filename}
              onClick={() => void download(file.path)}
              className="h-9 rounded-[var(--cp-radius)] border border-line bg-white px-3"
            >
              {KIND_LABEL[file.kind] ?? file.filename}
            </button>
          ))}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[#b45309]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
