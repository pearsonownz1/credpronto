import { describe, expect, it } from "vitest";
import { PRE_EVALUATION_FILE_LIMIT, PRE_EVALUATION_MAX_BYTES, PRE_EVALUATION_TYPE_MESSAGE, preEvaluationFileError } from "./file";

const pdf = { name: "diploma.pdf", type: "application/pdf", size: 1200 };

describe("pre-evaluation files", () => {
  it("uses the pre-evaluation upload size cap", () => {
    expect(PRE_EVALUATION_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(preEvaluationFileError({ ...pdf, size: PRE_EVALUATION_MAX_BYTES })).toBeNull();
    expect(preEvaluationFileError({ ...pdf, size: PRE_EVALUATION_MAX_BYTES + 1 })).toBe(PRE_EVALUATION_FILE_LIMIT);
  });

  it("accepts a PDF, JPG, or PNG and rejects other types", () => {
    expect(preEvaluationFileError(pdf)).toBeNull();
    expect(preEvaluationFileError({ name: "scan.jpg", type: "", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.jpeg", type: "image/jpeg", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.png", type: "image/png", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.PDF", type: "application/pdf", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.jpg", type: "image/jpg", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.heic", type: "image/heic", size: 10 })).toBe(PRE_EVALUATION_TYPE_MESSAGE);
    expect(preEvaluationFileError({ name: "scan.webp", type: "image/webp", size: 10 })).toBe(PRE_EVALUATION_TYPE_MESSAGE);
    expect(preEvaluationFileError({ name: "notes.txt", type: "text/plain", size: 10 })).toBe(PRE_EVALUATION_TYPE_MESSAGE);
    expect(preEvaluationFileError({ name: "scan.pdf", type: "image/png", size: 10 })).toBe(PRE_EVALUATION_TYPE_MESSAGE);
    expect(preEvaluationFileError({ name: "scan.pdf", type: "application/octet-stream", size: 10 })).toBe(
      PRE_EVALUATION_TYPE_MESSAGE,
    );
  });

  it("rejects an empty or missing file", () => {
    expect(preEvaluationFileError(null)).toBe("Upload a diploma or transcript.");
    expect(preEvaluationFileError({ ...pdf, size: 0 })).toBe("Empty files are not accepted");
  });
});
