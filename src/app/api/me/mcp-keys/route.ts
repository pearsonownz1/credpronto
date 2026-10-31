import { requireUser } from "@/lib/auth/session";
import { parseApiKeyName, publicApiKey } from "@/lib/orders/api-key";
import { insertApiKey, listApiKeys } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";
import { generateMcpApiKey, partitionApiKeys } from "@/lib/mcp/keys";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    const keys = partitionApiKeys(await listApiKeys(serviceDb(), user.id)).mcp;
    return json({ keys: keys.map(publicApiKey) });
  });
}

export async function POST(request: Request) {
  return run(async () => {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as { name?: unknown }) : {};
    const generated = generateMcpApiKey();
    const row = await insertApiKey(serviceDb(), {
      userId: user.id,
      name: parseApiKeyName(record.name ?? "MCP"),
      prefix: generated.prefix,
      keyHash: generated.hash,
      last4: generated.last4,
    });
    return json({ ...publicApiKey(row), secret: generated.secret }, 201);
  });
}
