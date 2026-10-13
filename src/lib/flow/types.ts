export type FlowStep = "upload" | "quote" | "confirm" | "preview" | "review" | "download";

export type FlowFileKind = "pdf" | "image";

export type FlowFile = {
  id: string;
  name: string;
  kind: FlowFileKind;
  description: string;
  words: number;
  sides: number;
};

export type ConfirmDetails = {
  fullName: string;
  dateOfBirth: string;
  father: string;
  mother: string;
  placeOfBirth: string;
  dateFormat: string;
  notes: string;
};

/** Draft the customer walks through. Backend's order API can return this shape. */
export type FlowDraft = {
  email: string;
  files: FlowFile[];
  sourceLanguage: string;
  targetLanguage: string;
  details: ConfirmDetails;
  orderId: string;
  paid: boolean;
};

export type PricedFile = FlowFile & {
  pages: number;
  amountCents: number;
};

export type FlowQuote = {
  files: PricedFile[];
  pages: number;
  wordCount: number;
  perPageCents: number;
  subtotalCents: number;
  previewCents: 0;
  totalCents: number;
  certificationIncluded: true;
};
