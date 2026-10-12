import { describe, expect, it } from "vitest";
import { assessTranslation, QA_REVIEW_REASON, qaAttemptForRound, qaStatusForRun, qaWillRetry } from "./qa";

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

  it("accepts a Chinese date of birth written in English", () => {
    const result = assessTranslation({
      originalPages: [{ number: 1, text: "出生日期一九九八年五月十日" }],
      translatedPages: [{ number: 1, text: "Date of birth: May 10, 1998." }],
      confirmations: [
        { fieldKey: "date_of_birth", confirmedValue: "一九九八年五月十日" },
        { fieldKey: "date_format", confirmedValue: "MM/DD/YYYY" },
      ],
    });
    expect(result).toEqual({ pass: true, score: 100, issues: [] });
    expect(
      assessTranslation({
        originalPages: [{ number: 1, text: "1998年5月10日" }],
        translatedPages: [{ number: 1, text: "Born 10 May 1998." }],
        confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "1998年5月10日" }],
      }).pass,
    ).toBe(true);
    expect(qaAttemptForRound(0)).toBe(1);
    expect(qaAttemptForRound(2)).toBe(3);
  });

  it("records an unreadable date as low severity and still fails a blank page", () => {
    const unreadable = assessTranslation({
      originalPages: [{ number: 1, text: "born then" }],
      translatedPages: [{ number: 1, text: "Born then." }],
      confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "sometime" }],
    });
    expect(unreadable.pass).toBe(true);
    expect(unreadable.issues).toEqual([
      expect.objectContaining({ type: "date", severity: "low", original: "sometime" }),
    ]);

    const blank = assessTranslation({
      originalPages: [{ number: 1, text: "出生日期一九九八年五月十日" }],
      translatedPages: [{ number: 1, text: "" }],
      confirmations: [{ fieldKey: "date_of_birth", confirmedValue: "一九九八年五月十日" }],
    });
    expect(blank.pass).toBe(false);
    expect(blank.issues.some((item) => item.type === "missing_text" && item.severity === "high")).toBe(true);
  });

  it("accepts a romanized name and records a missing non-Latin name as medium", () => {
    const passed = assessTranslation({
      originalPages: [{ number: 1, text: "张伟" }],
      translatedPages: [{ number: 1, text: "Name: Zhang Wei" }],
      confirmations: [{ fieldKey: "full_name", confirmedValue: "张伟" }],
    });
    expect(passed).toEqual({ pass: true, score: 100, issues: [] });

    const missing = assessTranslation({
      originalPages: [{ number: 1, text: "张伟" }],
      translatedPages: [{ number: 1, text: "Name withheld." }],
      confirmations: [{ fieldKey: "full_name", confirmedValue: "张伟" }],
    });
    expect(missing.pass).toBe(true);
    expect(missing.score).toBe(90);
    expect(missing.issues).toEqual([
      expect.objectContaining({ type: "name", severity: "medium", original: "张伟" }),
    ]);
  });
});
