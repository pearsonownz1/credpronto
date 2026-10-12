import { requireUser } from "@/lib/auth/session";
import { upsertWebhookEndpoint } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { assertWebhookUrl, generateWebhookSecret } from "@/lib/orders/outbound-webhook";
import { serviceDb } from "@/lib/orders/storage";

export async function PUT(request: Request) {
  return run(async () => {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as { url?: unknown }) : {};
    const url = assertWebhookUrl(record.url);
    const secret = generateWebhookSecret();
    const endpoint = await upsertWebhookEndpoint(serviceDb(), {
      userId: user.id,
      url,
      signingSecret: secret,
    });
    return json({ url: endpoint.url, secret });
  });
}
