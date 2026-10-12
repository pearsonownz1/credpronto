import type { FlowDraft } from "./types";

/** Designer sample: two sides, 278 words, $19.90 if the customer buys. */
export function sampleDraft(): FlowDraft {
  return {
    email: "maria.ruiz@email.com",
    sourceLanguage: "Spanish",
    targetLanguage: "English",
    orderId: "CP-24817",
    paid: false,
    files: [
      {
        id: "acta",
        name: "acta-nacimiento.pdf",
        kind: "pdf",
        description: "Birth certificate",
        words: 182,
        sides: 1,
      },
      {
        id: "back",
        name: "IMG_4021.HEIC",
        kind: "image",
        description: "Back of certificate",
        words: 96,
        sides: 1,
      },
    ],
    details: {
      fullName: "María Fernanda Ruiz Delgado",
      dateOfBirth: "14 March 1994",
      father: "Jorge Luis Ruiz Pérez",
      mother: "Ana María Delgado Soto",
      placeOfBirth: "Guadalajara, Jalisco, Mexico",
      dateFormat: "US · MM/DD/YYYY",
      notes: "",
    },
  };
}

export const PROCESSING_PERCENT = 62;

export const DATE_FORMATS = ["US · MM/DD/YYYY", "ISO · YYYY-MM-DD"] as const;

export function translatedDate(format: string) {
  return format.startsWith("ISO") ? "1994-03-14" : "03/14/1994";
}

export const DOWNLOADS = {
  certified: {
    href: "/samples/birth-certificate-en.pdf",
    filename: "birth-certificate-EN-certified.pdf",
    detail: "3 pages incl. certificate",
  },
  original: {
    href: "/samples/birth-certificate-es.pdf",
    filename: "acta-nacimiento.pdf",
  },
} as const;
