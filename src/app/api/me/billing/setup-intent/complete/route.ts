import { requireUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { completeSetupIntent } from "@/lib/orders/saved-card";
import { serviceDb } from "@/lib/orders/storage";

/** Saves the payment method after Stripe redirects back from SetupIntent confirm. */
export async function POST(request: Request) {
  return run(async () => {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const setupIntentId =
      body && typeof body === "object" ? (body as { setupIntentId?: unknown }).setupIntentId : null;
    if (typeof setupIntentId !== "string") throw new HttpError("setupIntentId is required", 400, "validation_error");
    return json(await completeSetupIntent(serviceDb(), user, setupIntentId));
  });
}
