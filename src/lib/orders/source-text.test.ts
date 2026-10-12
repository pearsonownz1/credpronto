import { describe, expect, it } from "vitest";
import { sourceTextForDisplay } from "./source-text";

describe("sourceTextForDisplay", () => {
  it("joins a stored run of one letter per line", () => {
    expect(sourceTextForDisplay("H\ne\nl\nl\no\n\nw\no\nr\nl\nd")).toBe("Hello world");
  });

  it("joins a string that was spread into single-character entries", () => {
    expect(sourceTextForDisplay(["H", "e", "l", "l", "o"])).toBe("Hello");
  });

  it("keeps real lines and ordinary paragraphs", () => {
    const paragraph = "Acta de nacimiento\nMaría Ruiz";
    expect(sourceTextForDisplay(paragraph)).toBe(paragraph);
    expect(sourceTextForDisplay(["First paragraph", "Second paragraph"])).toBe(
      "First paragraph\nSecond paragraph",
    );
  });

  it("returns null when there is no text", () => {
    expect(sourceTextForDisplay("  \n")).toBeNull();
    expect(sourceTextForDisplay([])).toBeNull();
    expect(sourceTextForDisplay(null)).toBeNull();
  });
});
