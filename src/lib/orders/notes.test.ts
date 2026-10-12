import { describe, expect, it } from "vitest";
import { parseNoteBody } from "./notes";

describe("order notes", () => {
  it("trims a note body", () => {
    expect(parseNoteBody({ body: "  Check the date.  " })).toBe("Check the date.");
  });

  it("rejects an empty note", () => {
    expect(() => parseNoteBody({ body: "   " })).toThrow(/1 to 4000/);
  });
});
