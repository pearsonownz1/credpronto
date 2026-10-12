import { describe, expect, it, vi } from "vitest";
import {
  adoptUploadInputs,
  checksAfterServiceChange,
  clearUploadDraft,
  readUploadDraft,
  serviceKeyFrom,
  uploadStateFromDraft,
  writeUploadDraft,
} from "./upload-draft";

const translation = { translation: true, diploma: false, courseByCourse: false };
const diplomaAndTranslation = { translation: true, diploma: true, courseByCourse: false };

describe("service toggle draft", () => {
  it("keeps the translation checkbox when the URL selects a diploma evaluation", () => {
    expect(checksAfterServiceChange(translation, "", "diploma")).toEqual(diplomaAndTranslation);
    expect(checksAfterServiceChange(diplomaAndTranslation, "diploma", "course_by_course")).toEqual({
      translation: true,
      diploma: false,
      courseByCourse: true,
    });
    expect(checksAfterServiceChange(diplomaAndTranslation, "diploma", "diploma")).toEqual(diplomaAndTranslation);
    expect(serviceKeyFrom("diploma")).toBe("diploma");
    expect(serviceKeyFrom("nope")).toBe("");
  });

  it("adopts an email, file, and diploma choice made before React state exists", () => {
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    expect(
      adoptUploadInputs(
        { email: "", files: [], checks: translation },
        { email: "ada@example.com", files: [file], checks: diplomaAndTranslation },
      ),
    ).toEqual({ email: "ada@example.com", files: [file], checks: diplomaAndTranslation });
  });

  it("does not let a fresh form replace a draft the customer already filled", () => {
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    expect(
      adoptUploadInputs(
        { email: "ada@example.com", files: [file], checks: diplomaAndTranslation },
        { email: "", files: [], checks: translation },
      ),
    ).toEqual({ email: "ada@example.com", files: [file], checks: diplomaAndTranslation });
  });

  it("stores the draft outside the form so a remount can read it", () => {
    clearUploadDraft();
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    writeUploadDraft({
      email: "ada@example.com",
      files: [file],
      checks: diplomaAndTranslation,
      degrees: "2",
      serviceKey: "",
    });
    expect(readUploadDraft()?.email).toBe("ada@example.com");
    expect(readUploadDraft()?.files).toEqual([file]);
    clearUploadDraft();
    expect(readUploadDraft()).toBeNull();
  });

  it("keeps a saved file flag when the form remounts before the file bytes are back", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    clearUploadDraft();
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    writeUploadDraft({
      email: "ada@example.com",
      files: [file],
      checks: diplomaAndTranslation,
      degrees: "2",
      serviceKey: "",
    });
    writeUploadDraft({
      email: "ada@example.com",
      files: [],
      checks: diplomaAndTranslation,
      degrees: "2",
      serviceKey: "diploma",
    });
    expect(JSON.parse(store.get("credpronto-upload-draft") ?? "{}").hasFiles).toBe(true);
    vi.unstubAllGlobals();
    clearUploadDraft();
  });

  it("restores files and email when diploma is selected from the URL", () => {
    clearUploadDraft();
    const file = new File(["%PDF"], "diploma.pdf", { type: "application/pdf" });
    writeUploadDraft({
      email: "ada@example.com",
      files: [file],
      checks: translation,
      degrees: "2",
      serviceKey: "",
    });
    expect(uploadStateFromDraft("diploma")).toMatchObject({
      email: "ada@example.com",
      files: [file],
      degrees: "2",
      checks: diplomaAndTranslation,
      serviceKey: "diploma",
    });
    clearUploadDraft();
    expect(uploadStateFromDraft("diploma").checks).toEqual({
      translation: false,
      diploma: true,
      courseByCourse: false,
    });
  });
});
