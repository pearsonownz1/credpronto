import { readGcsEditorPages, saveGcsTranslation } from "@/lib/gcs/save-translation";
import { assertGcsPin } from "@/lib/gcs/pin";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

type Context = { params: Promise<{ orderId: string }> };

/** Editable translation pages for the GCS desk. The PIN cookie or header is the grant. */
export async function GET(request: Request, context: Context) {
  const response = await run(async () => {
    assertGcsPin(request);
    const { orderId } = await context.params;
    return json({ pages: await readGcsEditorPages(serviceDb(), orderId) });
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Save edited pages, regenerate the certified PDF, and return a fresh preview URL. */
export async function PATCH(request: Request, context: Context) {
  const response = await run(async () => {
    assertGcsPin(request);
    const { orderId } = await context.params;
    const body = (await request.json().catch(() => null)) as { pages?: unknown } | null;
    return json(await saveGcsTranslation(serviceDb(), orderId, body?.pages));
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
