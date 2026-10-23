import { describe, expect, it } from "vitest";
import { blocksFromModel, isElectronicSignatureToken } from "./pdf/structure";
import { assessTranslation } from "./qa";

describe("prose is not an electronic signature", () => {
  it("keeps a sentence with the holder's name", () => {
    const blocks = blocksFromModel({ blocks: [{ type: "paragraph", text: "is awarded to Mr. KOUAMOU NANA MYRTHE ARISTIDE." }] });
    expect(blocks).toEqual([expect.objectContaining({ type: "paragraph", text: expect.stringContaining("KOUAMOU NANA MYRTHE ARISTIDE") })]);
  });

  it("still detects real tokens, whole or wrapped", () => {
    const token = "QWxndW5hIGZpcm1hIGVsZWN0cm9uaWNhIGRlIHBydWViYQ0KbGFyZ2E/AbCd0123+==";
    expect(isElectronicSignatureToken(token)).toBe(true);
    expect(isElectronicSignatureToken(`${token.slice(0, 30)} ${token.slice(30)}`)).toBe(true);
    expect(isElectronicSignatureToken("To enjoy the rights and privileges attached thereto.")).toBe(false);
    expect(isElectronicSignatureToken("The Technical and Vocational Secondary Education Baccalaureate diploma")).toBe(false);
  });
});

describe("confirmed names per document", () => {
  const name = "KOUAMOU NANA MYRTHE ARISTIDE";
  const base = {
    originalPages: [
      { number: 1, documentId: "diploma", text: `est conféré à M. ${name} né le 09/09/1979` },
      { number: 2, documentId: "transcript", text: `M. ${name} 09/09/1979` },
    ],
    confirmations: [
      { fieldKey: "full_name", confirmedValue: name, documentId: "diploma" },
      { fieldKey: "full_name", confirmedValue: name, documentId: "transcript" },
    ],
  };

  it("fails when one file drops the name another file still prints", () => {
    const result = assessTranslation({
      ...base,
      translatedPages: [
        { number: 1, text: "Born 09/09/1979" },
        { number: 2, text: `Mr. ${name} 09/09/1979` },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ type: "name", page: 1, original: name, severity: "high" })]);
  });

  it("passes when every file keeps the name", () => {
    const result = assessTranslation({
      ...base,
      translatedPages: [
        { number: 1, text: `awarded to Mr. ${name}, born 09/09/1979` },
        { number: 2, text: `Mr. ${name} 09/09/1979` },
      ],
    });
    expect(result.pass).toBe(true);
  });

  it("does not demand a name on a file that never printed it", () => {
    const result = assessTranslation({
      originalPages: [
        { number: 1, documentId: "diploma", text: `M. ${name} 09/09/1979` },
        { number: 2, documentId: "letter", text: "Attestation sans nom" },
      ],
      confirmations: [{ fieldKey: "full_name", confirmedValue: name }],
      translatedPages: [
        { number: 1, text: `Mr. ${name} 09/09/1979` },
        { number: 2, text: "Certificate without a name" },
      ],
    });
    expect(result.pass).toBe(true);
  });
});
