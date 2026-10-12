import { requireUser } from "@/lib/auth/session";
import { json, run } from "@/lib/orders/http";
import { currentBillingCard, removeSavedCard } from "@/lib/orders/saved-card";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    return json(await currentBillingCard(serviceDb(), user.id));
  });
}

export async function DELETE() {
  return run(async () => {
    const user = await requireUser();
    return json(await removeSavedCard(serviceDb(), user.id));
  });
}
