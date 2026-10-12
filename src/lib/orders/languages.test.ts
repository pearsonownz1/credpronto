import { describe, expect, it } from "vitest";
import {
  isSupportedSourceLanguage,
  languageLabel,
  sourceLanguageChoices,
  targetLanguageChoices,
} from "./languages";

describe("language labels", () => {
  it("shows Norwegian Bokmål once and never a raw code", () => {
    expect(languageLabel("nb")).toBe("Norwegian (Bokmål)");
    expect(languageLabel("no")).toBe("Norwegian (Bokmål)");
    expect(languageLabel("nb-NO")).toBe("Norwegian (Bokmål)");
    expect(isSupportedSourceLanguage("nb")).toBe(true);

    const source = sourceLanguageChoices();
    const labels = source.map((choice) => choice.label);
    expect(labels.filter((label) => label === "Norwegian (Bokmål)")).toEqual(["Norwegian (Bokmål)"]);
    expect(source.some((choice) => choice.code === "nb")).toBe(false);
    expect(labels.some((label) => /^[a-z]{2,3}$/i.test(label))).toBe(false);

    const target = targetLanguageChoices();
    expect(target.filter((choice) => choice.label === "Norwegian (Bokmål)")).toHaveLength(1);
    expect(target.some((choice) => choice.label === "English")).toBe(true);
    expect(new Set(target.map((choice) => choice.code)).size).toBe(target.length);
    expect(new Set(target.map((choice) => choice.label)).size).toBe(target.length);
  });

  it("does not fall back to a raw code", () => {
    expect(languageLabel("zz")).toBe("Unknown");
    expect(languageLabel("")).toBe("Unknown");
  });
});
