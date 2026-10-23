import { requireUser } from "@/lib/auth/session";
import { clioStore } from "@/lib/clio/store";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    const status = await clioStore(serviceDb()).status(user.id);
    if (!status.connected || !status.region) return json({ connected: false });
    return json({ connected: true, region: status.region });
  });
}
