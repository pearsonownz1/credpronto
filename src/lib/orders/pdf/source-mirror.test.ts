import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { planDocument, type PlanStyle } from "./document-layout";
import { fontFace, serifFace, stableFontkit } from "./font";
import { blocksFromSegmentTranslations, joinedLetterParagraph, layoutNeedsRestore, projectLetter, segmentSource } from "./source-mirror";

const OYAK_OCR = `OYAK BANK

İstanbul, 31/1/2006

Bankacılık Düzenleme ve Denetleme Kurumu
Kuruluşlar III Dairesi Başkanlığı

Atatürk Bulvarı No: 191 06684
Kavaklıdere / Ankara

Evrak No : 74
Konu : Atama İşlemi

Bankamıza Baş Hukuk Müşaviri olarak atanması söz konusu olan Sn. Çiğdem DAYAN'a ai
ilişikte yer almakta olup, 5411 sayılı Bankacılık Kanunu 25 / 2 f ve 3 f. ile Geçici 1. maddesine
yürürlükte bulunan Bankaların Kuruluş ve Faaliyetleri Hakkındaki Yönetmeliğin 14.
doğrultusunda gerekli değerlendirmeyi teminen bilgilerinize sunarız.

Saygılarımızla,

OYAK BANK A.Ş.
Genel Müdürlük

E. Hakan Eminsoy
Genel Müdür ve
Yönetim Kurulu Üyesi

Nejat Bilginer
Genel Müdür Yardımcısı

Ek: 1) Müflis olmadığına dair Asliye Ticaret Mahkemesi'nden alınan belge.
2) Konkordato ilan etmiş olmadığına dair İcra Tetkik Mercii'den alınan belge.
3) Adli Sicil Kaydı
4) Noter onaylı Nüfus Cüzdan Sureti
5) Ayrıntılı Özgeçmiş
6) Öğrenim durumunu tevsik eden belge.`;

const OYAK_WALL =
  "OYAK BANK Istanbul, 01/31/2006 Banking Regulation and Supervision Agency Department III of Institutions Atatürk Bulvarı No: 191 06684 Kavaklıdere / Ankara Document No: 74 Subject: Appointment Procedure The documents pertaining to Ms. Çiğdem DAYAN, whose appointment as Chief Legal Advisor to our Bank is under consideration, are attached hereto, and we submit them for your information to enable the necessary evaluation pursuant to paragraphs 2 and 3 of Article 25 and Provisional Article 1 of Banking Law No. 5411, as well as Article 14 of the Regulation on the Establishment and Activities of Banks currently in force. Sincerely, OYAK BANK A.Ş. Head Office E. Hakan Eminsoy General Manager and Member of the Board of Directors Nejat Bilginer Assistant General Manager Encl.: 1) Document obtained from the Civil Court of Commerce certifying that she is not bankrupt. 2) Document obtained from the Enforcement Examination Authority certifying that she has not declared concordat. 3) Criminal Record 4) Notarized Copy of Identity Card 5) Detailed Resume 6) Document certifying educational status.";

const LICENSE_OCR = `TÜRKİYE BAROLAR BİRLİĞİ
AVUKATLIK RUHSATNAMESİ

BİRLİK NO:
24379

BARO SİCİL NO:
15993

TÜRKİYE CUMHURİYETİ KANUNLARININ AVUKATLARA TANIDIĞI HAK VE YETKİLERİ KULLANMAK ÜZERE 1966 DOĞUMLU ÇİĞDEM DAYAN ' A BU AVUKATLIK RUHSATNAMESİ, BARO YÖNETİM KURULUNUN 7 . 9 . 1989 GÜNLÜ VE 33 SAYILI KARARI UYARINCA VERİLMİŞTİR.

İSTANBUL BAROSU BAŞKANI
AV. TURGUT KAZAN`;

async function measure() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(stableFontkit());
  const regular = await doc.embedFont(fontFace("regular").bytes);
  const serif = await doc.embedFont(serifFace(false).bytes);
  const bold = await doc.embedFont(serifFace(true).bytes);
  return (text: string, size: number, style: PlanStyle) => {
    const font = style.serif ? (style.bold ? bold : serif) : regular;
    return font.widthOfTextAtSize(text, size);
  };
}

describe("source arrangement for a photo", () => {
  it("reads the OYAK letter lines as letterhead, reference lines, signatures, and enclosures", () => {
    const plan = segmentSource(OYAK_OCR);
    expect(plan?.kind).toBe("letter");
    expect(plan?.segments.map((segment) => segment.role)).toEqual([
      "logo",
      "date",
      "address",
      "address",
      "kv",
      "kv",
      "body",
      "closing",
      "organization",
      "organization",
      "signature",
      "signature",
      "list",
    ]);
    expect(plan?.segments.find((segment) => segment.role === "kv")?.text).toContain("74");
    const signatures = plan?.segments.filter((segment) => segment.role === "signature") ?? [];
    expect(signatures.map((segment) => segment.column)).toEqual(["left", "right"]);
  });

  it("reads a license photo as headings, number boxes, and a signature", () => {
    const plan = segmentSource(LICENSE_OCR, { portrait: true });
    expect(plan?.kind).toBe("certificate");
    expect(plan?.segments.map((segment) => segment.role)).toEqual([
      "heading",
      "heading",
      "box",
      "photo",
      "box",
      "body",
      "signature",
    ]);
    expect(plan?.segments.filter((segment) => segment.role === "box").map((segment) => segment.column)).toEqual([
      "left",
      "right",
    ]);
  });

  it("keeps a joined letter whole and leaves a long form note alone", () => {
    expect(joinedLetterParagraph(OYAK_WALL)).toBe(true);
    expect(
      joinedLetterParagraph(
        "This certificate includes an annex with the civil registry notes and the parents' names as printed on the record.",
      ),
    ).toBe(false);
  });

  it("leaves a form transcription on the field path", () => {
    expect(segmentSource("ACTA DE NACIMIENTO\nNOMBRE\nVALERIA\nFECHA DE NACIMIENTO\n1 de mayo de 1990")).toBeNull();
    expect(
      layoutNeedsRestore("ACTA DE NACIMIENTO", [{ type: "paragraph", text: "Birth certificate" }]),
    ).toBeNull();
  });

  it("treats one paragraph as a collapsed letter and keeps a structured letter", () => {
    expect(layoutNeedsRestore(OYAK_OCR, [{ type: "paragraph", text: OYAK_WALL }])?.kind).toBe("letter");
    expect(
      layoutNeedsRestore(OYAK_OCR, [
        { type: "heading", text: "OYAK BANK" },
        { type: "paragraph", text: "Istanbul, 01/31/2006" },
        { type: "fields", rows: [{ label: "Document No.", value: "74" }] },
        { type: "signature", electronic: false },
        { type: "paragraph", text: "E. Hakan Eminsoy" },
      ]),
    ).toBeNull();
  });

  it("places the production paragraph wall back into the letter arrangement", async () => {
    const plan = segmentSource(OYAK_OCR);
    const blocks = projectLetter(plan?.segments ?? [], OYAK_WALL);
    expect(blocks?.some((block) => block.type === "logo")).toBe(true);
    const labels = blocks?.flatMap((block) => (block.type === "kv" ? [block.label] : [])) ?? [];
    expect(labels).toEqual(["Document No", "Subject"]);
    const values = blocks?.flatMap((block) => (block.type === "kv" ? [block.value] : [])) ?? [];
    expect(values).toEqual(["74", "Appointment Procedure"]);
    const body = blocks?.find((block) => block.type === "paragraph" && block.align === "justify");
    expect(body?.type === "paragraph" && body.text.startsWith("The documents")).toBe(true);
    expect(body?.type === "paragraph" && body.text).not.toContain("Document No");
    const list = blocks?.find((block) => block.type === "list");
    expect(list?.type === "list" && list.items).toHaveLength(6);
    const planned = planDocument({
      kind: "letter",
      blocks: blocks ?? [],
      width: 612,
      height: 792,
      footer: 48,
      size: 11,
      measure: await measure(),
      hasPhoto: false,
    });
    const hakan = planned.texts.find((item) => item.text === "Hakan");
    const nejat = planned.texts.find((item) => item.text === "Nejat");
    expect(hakan && nejat && hakan.x < nejat.x).toBe(true);
    expect(planned.texts.some((item) => item.text.startsWith("1)"))).toBe(true);
    expect(planned.texts.some((item) => item.text.startsWith("6)"))).toBe(true);
    expect(planned.texts.some((item) => item.text === "Document No")).toBe(true);
    expect(planned.texts.some((item) => item.text === "Subject")).toBe(true);
  });

  it("builds certificate blocks from a part-by-part translation", () => {
    const plan = segmentSource(LICENSE_OCR, { portrait: true });
    const blocks = blocksFromSegmentTranslations(plan?.segments ?? [], [
      { id: 1, text: "UNION OF TURKISH BAR ASSOCIATIONS" },
      { id: 2, text: "ATTORNEY AT LAW LICENSE" },
      { id: 3, text: "Union No.: 24379" },
      { id: 4, text: "Holder's photo" },
      { id: 5, text: "Bar Reg. No.: 15993" },
      { id: 6, text: "THIS LICENSE WAS ISSUED TO ÇİĞDEM DAYAN." },
      { id: 7, text: "ISTANBUL BAR ASSOCIATION PRESIDENT\nATTY. TURGUT KAZAN" },
    ]);
    expect(blocks?.map((block) => block.type)).toEqual(["heading", "heading", "box", "photo", "box", "paragraph", "signature"]);
    expect(blocks?.find((block) => block.type === "photo")).toMatchObject({ caption: "Holder's photo" });
  });
});
