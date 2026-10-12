import { requireUser } from "@/lib/auth/session";
import { latestWebhookDelivery, upsertWebhookEndpoint, webhookEndpointForUser } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { assertWebhookUrl, generateWebhookSecret, webhookReadBody } from "@/lib/orders/outbound-webhook";
import { serviceDb } from "@/lib/orders/storage";

export async function GET() {
  return run(async () => {
    const user = await requireUser();
    const db = serviceDb();
    const endpoint = await webhookEndpointForUser(db, user.id);
    if (!endpoint) return json({ url: null, secretLast4: null, lastDelivery: null });
    const lastDelivery = await latestWebhookDelivery(db, endpoint.id);
    return json(
      webhookReadBody({
        url: endpoint.url,
        signingSecret: endpoint.signingSecret,
        lastDelivery,
      }),
    );
  });
}

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
