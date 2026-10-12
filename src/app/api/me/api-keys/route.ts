import { requireUser } from "@/lib/auth/session";
import { generateApiKey, parseApiKeyMode, parseApiKeyName } from "@/lib/orders/api-key";
import { insertApiKey, listApiKeys } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    const keys = await listApiKeys(serviceDb(), user.id);
    return json({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        last4: key.last4,
        createdAt: key.createdAt,
        revokedAt: key.revokedAt,
      })),
    });
  });
}

export async function POST(request: Request) {
  return run(async () => {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as { name?: unknown; mode?: unknown }) : {};
    const generated = generateApiKey(parseApiKeyMode(record.mode));
    const row = await insertApiKey(serviceDb(), {
      userId: user.id,
      name: parseApiKeyName(record.name),
      prefix: generated.prefix,
      keyHash: generated.hash,
      last4: generated.last4,
    });
    return json(
      {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        last4: row.last4,
        secret: generated.secret,
        createdAt: row.createdAt,
      },
      201,
    );
  });
}
