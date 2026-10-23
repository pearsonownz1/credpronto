import { requireUser } from "@/lib/auth/session";
import { disconnectClio } from "@/lib/clio/actions";
import { clioCredentials } from "@/lib/clio/config";
import { clioStore } from "@/lib/clio/store";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function POST() {
  return run(async () => {
    const user = await requireUser();
    await disconnectClio({
      userId: user.id,
      store: clioStore(serviceDb()),
      fetchImpl: fetch,
      credentials: clioCredentials(),
    });
    return json({ connected: false });
  });
}
