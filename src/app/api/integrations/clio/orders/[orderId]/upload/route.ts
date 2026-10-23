import { requireUser } from "@/lib/auth/session";
import { retryClioUploadForUser } from "@/lib/clio/upload-back";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { isOrderId } from "@/lib/orders/token";

type Context = { params: Promise<{ orderId: string }> };

export async function POST(_request: Request, context: Context) {
  return run(async () => {
    const user = await requireUser();
    const { orderId } = await context.params;
    if (!isOrderId(orderId)) throw new HttpError("Order not found", 404);
    const result = await retryClioUploadForUser(serviceDb(), user.id, orderId);
    if (result.status === "failed") return json({ status: "failed", error: result.error }, 502);
    if (result.status !== "uploaded") throw new HttpError("Order not found", 404);
    return json({ status: "uploaded", clioDocumentId: result.clioDocumentId });
  });
}
