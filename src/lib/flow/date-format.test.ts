import { describe, expect, it } from "vitest";
import { defaultDateFormat, storedConfirmation } from "./date-format";

describe("confirm date format default", () => {
  it("matches a DD/MM hint and keeps a known MM/DD reading", () => {
    expect(defaultDateFormat("DD/MM/YYYY")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("DD/MM")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("dd/mm/yyyy")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("DD-MM-YYYY")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("MM/DD/YYYY", "14 March 1994")).toBe("MM/DD/YYYY");
    expect(defaultDateFormat("MM/DD", "09/19/1996")).toBe("MM/DD/YYYY");
    expect(defaultDateFormat("", "03/04/1996")).toBe("MM/DD/YYYY");
    expect(defaultDateFormat("DD/MM/YYYY", "03/04/1996")).toBe("DD/MM/YYYY");
  });

  it("does not read a Mexican acta date as MM/DD", () => {
    expect(defaultDateFormat("", "19/09/1996")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat(null, "19/09/1996")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("MM/DD/YYYY", "19/09/1996")).toBe("DD/MM/YYYY");
    expect(defaultDateFormat("MM/DD/YYYY", "19-09-1996")).toBe("DD/MM/YYYY");
    expect(storedConfirmation("", "DD/MM/YYYY")).toBe("DD/MM/YYYY");
    expect(storedConfirmation("  ", "19/09/1996")).toBe("19/09/1996");
    expect(defaultDateFormat(storedConfirmation("", "DD/MM"), storedConfirmation(null, "19/09/1996"))).toBe(
      "DD/MM/YYYY",
    );
  });
});
