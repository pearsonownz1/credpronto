import { clientIp, allowContact } from "@/lib/contact/rate-limit";
import { validateContact } from "@/lib/contact/validate";
import { sendContactMessage } from "@/lib/orders/email";
import { json } from "@/lib/orders/http";

const FAILED = "We couldn't send your message.";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: FAILED }, 400);
  }

  const parsed = validateContact(body);
  if (parsed.ok && parsed.honeypot) return json({ ok: true });
  if (!parsed.ok) return json({ ok: false, errors: parsed.errors }, 400);
  if (!allowContact(clientIp(request))) {
    return json({ ok: false, error: "Please wait a few minutes and try again." }, 429);
  }

  const result = await sendContactMessage(parsed.value);
  if (result.sent) return json({ ok: true });
  return json(
    { ok: false, error: FAILED, detail: result.detail ?? FAILED },
    result.skipped ? 503 : 502,
  );
}
