import type { RenderInput } from "./layout";

/**
 * Public homepage sample. Names and the order id are fake.
 * The cover template still prints the ATA logo and the Venture Oaks address.
 */
export const SAMPLE_COVER_INPUT: RenderInput = {
  orderId: "EXAMPLE-000",
  sourceLanguage: "es",
  targetLanguage: "en",
  date: "2026-01-15",
  clientName: "Alex Example",
  translatorName: "Example Translator",
  documents: [{ name: "example-birth-certificate.pdf", sourcePages: 1, translatedPages: 1 }],
  pages: [
    {
      combinedPageNumber: 1,
      widthPt: 612,
      heightPt: 792,
      paragraphs: ["This page is example data. It is not a real document."],
    },
  ],
};
