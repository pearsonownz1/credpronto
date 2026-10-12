import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { billableForText } from "./billing";
import { joinTextItems, type TextItemLike } from "./text-layer";
import { countWords, isCjkDominant } from "./words";

async function pageTexts(name: string): Promise<string[]> {
  const bytes = new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));
  const proxy = await getDocumentProxy(bytes);
  const texts: string[] = [];
  for (let n = 1; n <= proxy.numPages; n += 1) {
    const content = await (await proxy.getPage(n)).getTextContent();
    texts.push(joinTextItems(content.items as TextItemLike[]));
  }
  return texts;
}

/** Mirrors analysis.ts: words/250 or CJK characters/1000, chosen per page. */
function billWithoutAi(texts: string[]): number {
  return texts.reduce((sum, text) => sum + billableForText(text), 0);
}

describe("QA sample page counts", () => {
  it("counts the pt-BR certidão as 251 words and 2 billable pages", async () => {
    const texts = await pageTexts("pt-br_certidao-nascimento.pdf");
    expect(countWords(texts[0] ?? "")).toBe(251);
    expect(billWithoutAi(texts)).toBe(2);
  });

  it("keeps the French relevé page at exactly 250 words, 1 page", async () => {
    const texts = await pageTexts("fr_releve-notes_2p.pdf");
    expect(countWords(texts[1] ?? "")).toBe(250);
    expect(billWithoutAi(texts)).toBe(2);
  });

  it("bills the Chinese birth certificate by the CJK rule without AI: 1 page", async () => {
    const texts = await pageTexts("zh_chusheng-yixue-zhengming.pdf");
    expect(isCjkDominant(texts.join("\n"))).toBe(true);
    expect(billWithoutAi(texts)).toBe(1);
  });

  it("bills the two-page Chinese transcript as two physical pages", async () => {
    const texts = await pageTexts("zh_chengjidan_2p.pdf");
    expect(texts).toHaveLength(2);
    expect(billWithoutAi(texts)).toBe(2);
  });
});

describe("joinTextItems", () => {
  const item = (str: string, x: number, rot = 0, hasEOL = false): TextItemLike => ({
    str,
    transform: [10 * Math.cos(rot), 10 * Math.sin(rot), 0, 10, x, 0],
    width: 6,
    hasEOL,
  });
  it("splits glyphs with different rotations", () => {
    expect(joinTextItems([item("M", 0, 0.1), item("P", 6, 0.4)])).toBe("M P");
  });
  it("joins adjacent runs on one baseline", () => {
    expect(joinTextItems([item("Cer", 0), item("tidão", 6)])).toBe("Certidão");
  });
});

describe("isCjkDominant", () => {
  it("detects Chinese, Japanese, Korean and rejects Latin", () => {
    expect(isCjkDominant("出生医学证明 SAMPLE 2010")).toBe(true);
    expect(isCjkDominant("ひらがなとカタカナ")).toBe(true);
    expect(isCjkDominant("대한민국 출생증명서")).toBe(true);
    expect(isCjkDominant("Certidão de nascimento 1º")).toBe(false);
    expect(isCjkDominant("")).toBe(false);
  });
});
