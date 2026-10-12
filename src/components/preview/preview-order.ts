/**
 * Shape of the preview payload Backend will return.
 * `original.url` and `translation.url` are signed URLs. This demo
 * points them at same-origin sample PDFs. Page N of the translation
 * is page N of the original, and each entry carries that page's size
 * in PDF points.
 */
export type PreviewPageSize = {
  page: number;
  widthPt: number;
  heightPt: number;
  /** Present on live and flow-mock previews. Demo fixtures omit them. */
  documentId?: string;
  documentIndex?: number;
  documentName?: string;
};

export type PreviewCorrection = {
  id: string;
  page: number;
  documentId?: string | null;
  documentName?: string;
  /** Set when the reader selected text. Null while pages are images. */
  passage: string | null;
  note: string;
  status: "sent";
  label: string;
  detail: string;
};

export type DocumentGroup = {
  documentId: string;
  documentIndex: number;
  documentName: string;
  firstPage: number;
};

/** Unique source documents in upload order, with the first PDF page of each. */
export function documentGroups(pages: PreviewPageSize[]): DocumentGroup[] {
  const groups: DocumentGroup[] = [];
  for (const page of pages) {
    if (!page.documentId) continue;
    if (groups.some((group) => group.documentId === page.documentId)) continue;
    groups.push({
      documentId: page.documentId,
      documentIndex: page.documentIndex ?? groups.length,
      documentName: page.documentName ?? "",
      firstPage: page.page,
    });
  }
  return groups.sort(
    (a, b) => a.documentIndex - b.documentIndex || a.firstPage - b.firstPage,
  );
}

export type PreviewDocument = {
  url: string;
  subtitle: string;
  pages: PreviewPageSize[];
};

export type PreviewOrder = {
  id: string;
  status: "preview_ready";
  sourceLanguage: string;
  targetLanguage: string;
  filename: string;
  pageCount: number;
  original: PreviewDocument;
  translation: PreviewDocument;
  pricing: {
    perPageCents: number;
    pages: number;
    certificationIncluded: boolean;
    totalCents: number;
  };
  included: string[];
  corrections: PreviewCorrection[];
};

const PER_PAGE_CENTS = 995;

const INCLUDED = [
  "Clean PDF, no watermark",
  "Signed certificate of accuracy",
  "Meets USCIS certification rules",
  "Emailed and downloadable",
];

function letterPages(count: number): PreviewPageSize[] {
  return Array.from({ length: count }, (_, index) => ({
    page: index + 1,
    widthPt: 612,
    heightPt: 792,
  }));
}

function pricing(pages: number): PreviewOrder["pricing"] {
  return {
    perPageCents: PER_PAGE_CENTS,
    pages,
    certificationIncluded: true,
    totalCents: pages * PER_PAGE_CENTS,
  };
}

export function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buyLabel(order: PreviewOrder) {
  return `Buy & download — ${formatMoney(order.pricing.totalCents)}`;
}

export function statusLabel(order: PreviewOrder) {
  return order.status === "preview_ready" ? "Preview ready" : order.status;
}

export const CERTIFICATE_PREVIEW: PreviewOrder = {
  id: "CP-24817",
  status: "preview_ready",
  sourceLanguage: "Spanish",
  targetLanguage: "English",
  filename: "birth-certificate.pdf",
  pageCount: 3,
  original: {
    url: "/samples/birth-certificate-es.pdf",
    subtitle: "Spanish · scanned",
    pages: letterPages(3),
  },
  translation: {
    url: "/samples/birth-certificate-en.pdf",
    subtitle: "English · watermarked preview",
    pages: letterPages(3),
  },
  pricing: pricing(3),
  included: INCLUDED,
  corrections: [
    {
      id: "cor-birth-date",
      page: 1,
      passage: null,
      note: "Should read 14 March 1994 (day first)",
      status: "sent",
      label: "Date of birth",
      detail: "sent, new preview in ~5 min",
    },
  ],
};

export const LONG_PREVIEW: PreviewOrder = {
  id: "CP-31002",
  status: "preview_ready",
  sourceLanguage: "Spanish",
  targetLanguage: "English",
  filename: "long-sample.pdf",
  pageCount: 12,
  original: {
    url: "/samples/long-es.pdf",
    subtitle: "Spanish · sample",
    pages: letterPages(12),
  },
  translation: {
    url: "/samples/long-en.pdf",
    subtitle: "English · watermarked preview",
    pages: letterPages(12),
  },
  pricing: pricing(12),
  included: INCLUDED,
  corrections: [],
};

export function pagesAlign(order: PreviewOrder) {
  const original = order.original.pages;
  const translation = order.translation.pages;
  return (
    original.length === order.pageCount &&
    translation.length === order.pageCount &&
    original.every((page, index) => {
      const match = translation[index];
      return (
        page.page === index + 1 &&
        match?.page === page.page &&
        match.widthPt === page.widthPt &&
        match.heightPt === page.heightPt &&
        (match.documentId ?? null) === (page.documentId ?? null) &&
        (match.documentName ?? null) === (page.documentName ?? null)
      );
    })
  );
}
