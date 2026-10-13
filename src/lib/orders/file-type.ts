const EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const ALLOWED = new Set(Object.values(EXTENSIONS));

export function resolveUploadMime(filename: string, mime: string): string | null {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ALLOWED.has(normalized)) return normalized === "image/jpg" ? "image/jpeg" : normalized;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[extension] ?? null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "upload";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "upload";
}
