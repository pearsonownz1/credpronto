import { describe, expect, it } from "vitest";
import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES } from "@/lib/orders/constants";
import { PRE_EVALUATION_MAX_BYTES, preEvaluationFileError } from "./file";

const pdf = { name: "diploma.pdf", type: "application/pdf", size: 1200 };

describe("pre-evaluation files", () => {
  it("uses the customer upload size cap", () => {
    expect(PRE_EVALUATION_MAX_BYTES).toBe(MAX_DIRECT_FILE_BYTES);
    expect(preEvaluationFileError({ ...pdf, size: MAX_DIRECT_FILE_BYTES })).toBeNull();
    expect(preEvaluationFileError({ ...pdf, size: MAX_DIRECT_FILE_BYTES + 1 })).toBe(DIRECT_FILE_LIMIT_MESSAGE);
  });

  it("accepts a PDF, JPG, or PNG and rejects other types", () => {
    expect(preEvaluationFileError(pdf)).toBeNull();
    expect(preEvaluationFileError({ name: "scan.jpg", type: "", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.jpeg", type: "image/jpeg", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.png", type: "image/png", size: 10 })).toBeNull();
    expect(preEvaluationFileError({ name: "scan.heic", type: "image/heic", size: 10 })).toBe("Upload a PDF, JPG, or PNG.");
    expect(preEvaluationFileError({ name: "scan.webp", type: "image/webp", size: 10 })).toBe("Upload a PDF, JPG, or PNG.");
    expect(preEvaluationFileError({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("Upload a PDF, JPG, or PNG.");
  });

  it("rejects an empty or missing file", () => {
    expect(preEvaluationFileError(null)).toBe("Upload a diploma or transcript.");
    expect(preEvaluationFileError({ ...pdf, size: 0 })).toBe("Empty files are not accepted");
  });
});
