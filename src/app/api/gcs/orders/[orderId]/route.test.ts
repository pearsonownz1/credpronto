import { beforeEach, describe, expect, it, vi } from "vitest";
import { GCS_PIN_COOKIE, GCS_PIN_HEADER, gcsPinSessionToken } from "@/lib/gcs/pin";

const readGcsEditorPages = vi.hoisted(() => vi.fn());
const saveGcsTranslation = vi.hoisted(() => vi.fn());

vi.mock("@/lib/gcs/save-translation", () => ({
  readGcsEditorPages,
  saveGcsTranslation,
}));

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "service" }),
}));

import { GET, PATCH } from "./route";

const orderId = "28492f38-1111-4111-8111-111111111111";
const pages = [
  {
    documentId: "doc-1",
    pageNumber: 1,
    combinedPageNumber: 1,
    widthPt: 612,
    heightPt: 792,
    kind: "form",
    blocks: [{ type: "paragraph", text: "Hello" }],
    paragraphs: ["Hello"],
  },
];

function context() {
  return { params: Promise.resolve({ orderId }) };
}

describe("GET and PATCH /api/gcs/orders/[orderId]", () => {
  beforeEach(() => {
    readGcsEditorPages.mockReset();
    saveGcsTranslation.mockReset();
    readGcsEditorPages.mockResolvedValue(pages);
    saveGcsTranslation.mockResolvedValue({
      translatedPdfUrl: "https://files.example/certified-translation.pdf",
      pages,
    });
  });

  it("requires the GCS PIN", async () => {
    const denied = await GET(new Request(`https://translate.gcs.org/api/gcs/orders/${orderId}`), context());
    expect(denied.status).toBe(401);
    expect(readGcsEditorPages).not.toHaveBeenCalled();

    const patched = await PATCH(
      new Request(`https://translate.gcs.org/api/gcs/orders/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pages }),
      }),
      context(),
    );
    expect(patched.status).toBe(401);
    expect(saveGcsTranslation).not.toHaveBeenCalled();
  });

  it("returns editor pages and saves a regenerated PDF", async () => {
    const headers = { cookie: `${GCS_PIN_COOKIE}=${gcsPinSessionToken()}` };
    const loaded = await GET(new Request(`https://translate.gcs.org/api/gcs/orders/${orderId}`, { headers }), context());
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await loaded.json()).toEqual({ pages });
    expect(readGcsEditorPages).toHaveBeenCalledWith({ kind: "service" }, orderId);

    const saved = await PATCH(
      new Request(`https://translate.gcs.org/api/gcs/orders/${orderId}`, {
        method: "PATCH",
        headers: { ...headers, [GCS_PIN_HEADER]: "123456", "content-type": "application/json" },
        body: JSON.stringify({ pages }),
      }),
      context(),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      translatedPdfUrl: "https://files.example/certified-translation.pdf",
      pages,
    });
    expect(saveGcsTranslation).toHaveBeenCalledWith({ kind: "service" }, orderId, pages);
  });
});
