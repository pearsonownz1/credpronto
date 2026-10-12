import { requireUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { revokeApiKey } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  return run(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const row = await revokeApiKey(serviceDb(), user.id, id);
    if (!row) throw new HttpError("API key not found", 404);
    return json({ id: row.id, revokedAt: row.revokedAt });
  });
}
