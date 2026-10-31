import { requireUser } from "@/lib/auth/session";
import { HttpError } from "@/lib/orders/errors";
import { listApiKeys, revokeApiKey } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { MCP_KEY_PREFIX } from "@/lib/mcp/keys";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  return run(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const db = serviceDb();
    const key = (await listApiKeys(db, user.id)).find((item) => item.id === id);
    if (!key || key.prefix === MCP_KEY_PREFIX) throw new HttpError("API key not found", 404);
    const row = await revokeApiKey(db, user.id, id);
    if (!row) throw new HttpError("API key not found", 404);
    return json({ id: row.id, revokedAt: row.revokedAt });
  });
}
