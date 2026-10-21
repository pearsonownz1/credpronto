import type { RenderBlock } from "./layout";

/** Turkish wording read from the attached OYAK appointment letter. */
export const OYAK_SOURCE = `İstanbul, 31/1/2006
Bankacılık Düzenleme ve Denetleme Kurumu
Kuruluşlar III Dairesi Başkanlığı
Atatürk Bulvarı No:191 06684
Kavaklıdere / Ankara
Evrak No : 74
Konu : Atama İşlemi
Sn. Çiğdem DAYAN, Baş Hukuk Müşaviri
5411 sayılı Bankacılık Kanunu 25 / 2 f ve 3 f. ile Geçici 1. maddesi
Bankaların Kuruluş ve Faaliyetleri Hakkındaki Yönetmeliğin 14
Saygılarımızla
OYAK BANK A.Ş. Genel Müdürlük
E. Hakan Eminsoy Genel Müdür ve Yönetim Kurulu Üyesi
Nejat Bilginer Genel Müdür Yardımcısı`;

/** Turkish wording read from the attached attorney license. */
export const LICENSE_SOURCE = `TÜRKİYE BAROLAR BİRLİĞİ
AVUKATLIK RUHSATNAMESİ
BİRLİK NO: 24379
BARO SİCİL NO: 15993
1966 DOĞUMLU ÇİĞDEM DAYAN
7. 9. 1989
33 SAYILI
İSTANBUL BAROSU BAŞKANI AV. TURGUT KAZAN`;

export const oyakLetterBlocks: RenderBlock[] = [
  { type: "logo", text: "OYAK BANK" },
  { type: "paragraph", text: "Istanbul, 01/31/2006", align: "left" },
  {
    type: "address",
    bold: true,
    lines: ["Banking Regulation and Supervision Agency", "Department of Boards III"],
  },
  { type: "address", lines: ["Atatürk Boulevard No.: 191 06684", "Kavaklıdere / Ankara"] },
  { type: "kv", label: "Document No.", value: "74" },
  { type: "kv", label: "Subject", value: "Appointment Procedure" },
  {
    type: "paragraph",
    align: "justify",
    text: "Attached is the letter regarding **Ms. Çiğdem DAYAN**, who is to be appointed as Chief Legal Counsel to our Bank, we hereby submit for your information in order to ensure the necessary assessment in accordance with Article 25/2f and 3f, and Provisional Article 1 of the Banking Law No. 5411 and Article 14 of the Regulation on the Establishment and Activities of Banks in force.",
  },
  { type: "paragraph", text: "Kind regards,", align: "left" },
  { type: "paragraph", text: "OYAK BANK Inc.", bold: true, align: "left" },
  { type: "paragraph", text: "General Management", align: "left" },
  {
    type: "signature",
    electronic: false,
    column: "left",
    lines: ["**E. Hakan Eminsoy**", "General Manager and", "Executive Board Member"],
  },
  {
    type: "signature",
    electronic: false,
    column: "right",
    lines: ["**Nejat Bilginer**", "Deputy General Manager"],
  },
  {
    type: "list",
    ordered: true,
    label: "Attachment:",
    items: [
      "Bankruptcy certificate",
      "Concordat certificate",
      "Criminal record",
      "Identity card",
      "Curriculum vitae",
      "Education documents",
    ],
  },
];

export const licenseBlocks: RenderBlock[] = [
  { type: "heading", text: "UNION OF TURKISH BAR ASSOCIATIONS", align: "center" },
  { type: "heading", text: "ATTORNEY AT LAW LICENSE", align: "center", bold: true },
  { type: "box", label: "Union No.", value: "24379", column: "left" },
  { type: "photo", caption: "Holder's photo" },
  { type: "box", label: "Bar Reg. No.", value: "15993", column: "right" },
  {
    type: "paragraph",
    caps: true,
    align: "center",
    text: "THIS ATTORNEY AT LAW LICENSE WAS ISSUED TO ÇİĞDEM DAYAN, BORN IN 1966, TO EXERCISE THE RIGHTS AND POWERS GRANTED TO ATTORNEYS BY THE LAWS OF THE REPUBLIC OF TURKEY BY THE DECISION OF THE BAR EXECUTIVE BOARD DATED 09/07/1989 AND NUMBERED 33.",
  },
  { type: "seal", text: "", column: "left" },
  { type: "seal", text: "", column: "right" },
  {
    type: "signature",
    electronic: false,
    column: "right",
    lines: ["**ISTANBUL BAR ASSOCIATION PRESIDENT**", "ATTY. TURGUT KAZAN"],
  },
];
