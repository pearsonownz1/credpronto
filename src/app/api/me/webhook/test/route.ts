import { requireUser } from "@/lib/auth/session";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { sendTestWebhook } from "@/lib/orders/webhook-delivery";

export async function POST() {
  return run(async () => {
    const user = await requireUser();
    return json(await sendTestWebhook(serviceDb(), user.id));
  });
}
