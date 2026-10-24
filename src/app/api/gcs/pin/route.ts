import { gcsPinCookieHeader, pinIsValid } from "@/lib/gcs/pin";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";

export async function POST(request: Request) {
  return run(async () => {
    const body = await request.json().catch(() => null);
    const pin = body && typeof body === "object" && !Array.isArray(body) ? (body as { pin?: unknown }).pin : null;
    if (typeof pin !== "string" || !pinIsValid(pin)) {
      throw new HttpError("That PIN is not correct.", 401);
    }
    const response = json({ ok: true });
    response.headers.append("set-cookie", gcsPinCookieHeader());
    return response;
  });
}
