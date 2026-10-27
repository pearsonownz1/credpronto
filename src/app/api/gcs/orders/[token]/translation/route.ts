import { json, run } from "@/lib/orders/http";
import { readGcsTranslation, requireGcsTranslationOrder, saveGcsTranslation } from "@/lib/orders/gcs-translation";
import { getPreview } from "@/lib/orders/preview-read";

type Context = { params: Promise<{ token: string }> };

/** Translated text for the GCS desk editor. The PIN cookie is the grant. */
export async function GET(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const { db, order } = await requireGcsTranslationOrder(request, token);
    const response = json(await readGcsTranslation(db, order));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}

/** Save editor text, regenerate the certified PDF, and return the new preview. */
export async function PUT(request: Request, context: Context) {
  return run(async () => {
    const { token } = await context.params;
    const { db, order } = await requireGcsTranslationOrder(request, token);
    const body = await request.json().catch(() => null);
    const saved = await saveGcsTranslation(db, order, body);
    const preview = await getPreview(token);
    const response = json({ pages: saved.pages, preview: preview.body, order: { id: order.id, status: order.status } });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
