import { describe, expect, it } from "vitest";
import { assessTranslation, QA_REVIEW_REASON, qaStatusForRun, qaWillRetry } from "./qa";

const originalPages = [
  { number: 1, text: "Acta de Ada Lovelace. Nació el 14/10/1815. Folio 2019." },
];

const confirmations = [
  { fieldKey: "full_name", confirmedValue: "Ada Lovelace" },
  { fieldKey: "date_of_birth", confirmedValue: "14/10/1815" },
  { fieldKey: "place_of_birth", confirmedValue: "London" },
  { fieldKey: "parent_names", confirmedValue: "Anne Isabella Milbanke; Lord Byron" },
  { fieldKey: "date_format", confirmedValue: "DD/MM/YYYY" },
];

describe("translation QA", () => {
  it("passes when confirmed names, the date, and numbers are present", () => {
    const result = assessTranslation({
      originalPages,
      translatedPages: [
        {
          number: 1,
          text: "Birth record of Ada Lovelace, daughter of Anne Isabella Milbanke and Lord Byron, born in London on 14/10/1815. Folio 2019.",
        },
      ],
      confirmations,
    });
    expect(result).toEqual({ pass: true, score: 100, issues: [] });
    expect(qaStatusForRun({ pass: true, attempt: 1 })).toBe("pass");
  });

  it("fails a missing name and a missing number, and retries until the third run", () => {
    const result = assessTranslation({
      originalPages,
      translatedPages: [{ number: 1, text: "Birth record. London. Anne Isabella Milbanke. Lord Byron. 14/10/1815." }],
      confirmations,
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(50);
    expect(result.issues.map((item) => item.type).sort()).toEqual(["name", "number"]);
    expect(result.issues.find((item) => item.type === "name")).toMatchObject({
      severity: "high",
      page: null,
      original: "Ada Lovelace",
      translated: "",
    });
    expect(result.issues.find((item) => item.type === "number")).toMatchObject({
      severity: "high",
      page: 1,
      original: "2019",
    });
    expect(qaWillRetry({ pass: false, attempt: 1 })).toBe(true);
    expect(qaWillRetry({ pass: false, attempt: 2 })).toBe(true);
    expect(qaWillRetry({ pass: false, attempt: 3 })).toBe(false);
    expect(qaStatusForRun({ pass: false, attempt: 2 })).toBe("retranslated");
    expect(qaStatusForRun({ pass: false, attempt: 3 })).toBe("fail");
    expect(qaStatusForRun({ pass: true, attempt: 2 })).toBe("retranslated");
    expect(QA_REVIEW_REASON).toBe("QA found issues that were not fixed after 2 retranslations.");
  });

  it("flags an empty translation and a page-count mismatch", () => {
    const result = assessTranslation({
      originalPages: [{ number: 1, text: "Acta de nacimiento." }],
      translatedPages: [],
      confirmations: [],
    });
    expect(result.issues.map((item) => item.type)).toEqual(["layout", "missing_text"]);
    expect(result.issues[0]).toMatchObject({
      type: "layout",
      page: null,
      original: "1 pages",
      translated: "0 pages",
    });
    expect(result.issues[1]).toMatchObject({ type: "missing_text", page: 1, translated: "" });
  });
});
