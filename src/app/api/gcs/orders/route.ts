import { listGcsHistory } from "@/lib/gcs/history";
import { assertGcsPin } from "@/lib/gcs/pin";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

/** Recent GCS translations for the desk sidebar. The PIN cookie is the grant. */
export async function GET(request: Request) {
  return run(async () => {
    assertGcsPin(request);
    const response = json({ orders: await listGcsHistory(serviceDb()) });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
