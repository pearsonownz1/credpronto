import { parseEvaluationService, type ServiceChecks } from "@/lib/flow/order-choice";

export type UploadDraft = {
  email: string;
  files: File[];
  checks: ServiceChecks;
  degrees: string;
  /** Service named in the URL when this draft was saved. Empty means the URL did not name one. */
  serviceKey: string;
};

type StoredDraft = {
  email: string;
  checks: ServiceChecks;
  degrees: string;
  serviceKey: string;
  hasFiles: boolean;
};

const STORAGE_KEY = "credpronto-upload-draft";
const DB_NAME = "credpronto-upload";
const FILE_KEY = "draft";

let memory: UploadDraft | null = null;

export function draftHasStoredFiles(): boolean {
  return readStoredDraft()?.hasFiles === true;
}

export function readUploadDraft(): UploadDraft | null {
  const stored = readStoredDraft();
  if (memory) return memory;
  if (!stored) return null;
  return { ...stored, files: [] };
}

export function writeUploadDraft(next: UploadDraft) {
  const previous = readStoredDraft();
  const keepFiles = next.files.length === 0 && previous?.hasFiles === true;
  memory = keepFiles ? { ...next, files: memory?.files ?? [] } : next;
  const stored: StoredDraft = {
    email: next.email,
    checks: next.checks,
    degrees: next.degrees,
    serviceKey: next.serviceKey,
    hasFiles: next.files.length > 0 || keepFiles,
  };
  writeStoredDraft(stored);
  if (!keepFiles) void writeStoredFiles(next.files);
}

export function clearUploadDraft() {
  memory = null;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
  void writeStoredFiles([]);
}

/**
 * Upload `?service=` values.
 * `evaluation` selects a diploma evaluation. Anything else unrecognized is ignored.
 */
export function uploadServiceFromQuery(
  value: string | null | undefined,
): "translation" | "diploma" | "course_by_course" | null {
  if (value === "translation") return "translation";
  if (value === "evaluation") return "diploma";
  return parseEvaluationService(value);
}

export function serviceKeyFrom(initialService: string | null | undefined): string {
  return uploadServiceFromQuery(initialService) ?? "";
}

export function initialChecks(initialService: string | null | undefined): ServiceChecks {
  const service = uploadServiceFromQuery(initialService);
  if (service === "diploma") return { translation: false, diploma: true, courseByCourse: false };
  if (service === "course_by_course") return { translation: false, diploma: false, courseByCourse: true };
  return { translation: true, diploma: false, courseByCourse: false };
}

/** Remounts keep the upload. A new `service` query only changes which evaluation is checked. */
export function uploadStateFromDraft(initialService: string | null | undefined): {
  email: string;
  files: File[];
  degrees: string;
  checks: ServiceChecks;
  serviceKey: string;
} {
  const saved = readUploadDraft();
  const serviceKey = serviceKeyFrom(initialService);
  if (!saved) {
    return { email: "", files: [], degrees: "1", checks: initialChecks(initialService), serviceKey };
  }
  return {
    email: saved.email,
    files: saved.files,
    degrees: saved.degrees || "1",
    checks: checksAfterServiceChange(saved.checks, saved.serviceKey, serviceKey),
    serviceKey,
  };
}

/**
 * A named service in the URL selects that service.
 * `translation` clears both evaluations. An evaluation clears the other evaluation
 * and leaves the translation checkbox as it was. An empty key leaves the checks alone.
 */
export function checksAfterServiceChange(
  current: ServiceChecks,
  previousKey: string,
  nextKey: string,
): ServiceChecks {
  if (previousKey === nextKey) return current;
  if (nextKey === "translation") return { translation: true, diploma: false, courseByCourse: false };
  if (nextKey === "diploma") return { ...current, diploma: true, courseByCourse: false };
  if (nextKey === "course_by_course") return { ...current, diploma: false, courseByCourse: true };
  return current;
}

/** Values typed before hydration win when React state has not caught up yet. */
export function adoptUploadInputs(
  state: { email: string; files: File[]; checks: ServiceChecks },
  dom: { email: string; files: File[]; checks: ServiceChecks | null },
): { email: string; files: File[]; checks: ServiceChecks } {
  const email = state.email || dom.email;
  const files = state.files.length > 0 ? state.files : dom.files;
  const domPickedEvaluation = Boolean(dom.checks && (dom.checks.diploma || dom.checks.courseByCourse));
  const statePickedEvaluation = state.checks.diploma || state.checks.courseByCourse;
  const checks = dom.checks && domPickedEvaluation && !statePickedEvaluation ? dom.checks : state.checks;
  return { email, files, checks };
}

export async function readStoredFiles(): Promise<File[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const database = await openFiles();
    return await new Promise((resolve) => {
      const request = database.transaction("files", "readonly").objectStore("files").get(FILE_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(Array.isArray(value) ? value.filter((file): file is File => file instanceof File) : []);
      };
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

function readStoredDraft(): StoredDraft | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!parsed.checks || typeof parsed.email !== "string" || typeof parsed.degrees !== "string") return null;
    if (
      typeof parsed.checks.translation !== "boolean" ||
      typeof parsed.checks.diploma !== "boolean" ||
      typeof parsed.checks.courseByCourse !== "boolean"
    ) {
      return null;
    }
    return {
      email: parsed.email,
      checks: parsed.checks,
      degrees: parsed.degrees,
      serviceKey: typeof parsed.serviceKey === "string" ? parsed.serviceKey : "",
      hasFiles: parsed.hasFiles === true,
    };
  } catch {
    return null;
  }
}

function writeStoredDraft(draft: StoredDraft) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

async function writeStoredFiles(files: File[]) {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openFiles();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction("files", "readwrite").objectStore("files").put(files, FILE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // The tab can still keep the files in memory for this page.
  }
}

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
