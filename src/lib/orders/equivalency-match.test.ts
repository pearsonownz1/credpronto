import { describe, expect, it } from "vitest";
import { extractedCredentialTitles } from "./equivalency-match";

describe("extracted credential titles", () => {
  it("reads diploma and course titles and skips a blank one", () => {
    expect(
      extractedCredentialTitles({
        kind: "diploma",
        credentials: [
          { country: "Mexico", credential: "LICENCIADA en Administración de Empresas", equivalencyBasis: "hidden" },
          { country: "Mexico", credential: " " },
        ],
      }),
    ).toEqual([{ country: "Mexico", title: "LICENCIADA en Administración de Empresas" }]);
    expect(
      extractedCredentialTitles({
        kind: "course_by_course",
        country: "Brazil",
        credential: "Bacharel em Engenharia",
        equivalencyBasis: "hidden",
      }),
    ).toEqual([{ country: "Brazil", title: "Bacharel em Engenharia" }]);
    expect(extractedCredentialTitles(null)).toEqual([]);
  });
});
