import { requireUser } from "@/lib/auth/session";
import { json, run } from "@/lib/orders/http";
import { createSetupIntent } from "@/lib/orders/saved-card";
import { serviceDb } from "@/lib/orders/storage";

export async function POST() {
  return run(async () => {
    const user = await requireUser();
    return json(await createSetupIntent(serviceDb(), user));
  });
}
