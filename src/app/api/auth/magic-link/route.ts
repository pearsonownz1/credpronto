import { readEmail, readJson, readNext, readOrderToken } from "@/lib/auth/body";
import { emailHasAccount, generateConfirmLink } from "@/lib/auth/email-link";
import { attachOrderToken } from "@/lib/auth/order-link";
import { requestOrigin } from "@/lib/auth/redirect";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { sendAuthLink } from "@/lib/orders/email";
import { renderAuthLinkEmail } from "@/lib/orders/email-templates";
import { serviceDb } from "@/lib/orders/storage";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    const email = readEmail(body);
    const orderToken = readOrderToken(body);
    const origin = requestOrigin(request);

    let exists = true;
    try {
      exists = await emailHasAccount(email);
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) throw error;
      exists = true;
    }

    const link = await generateConfirmLink({
      email,
      purpose: "magiclink",
      origin,
      next: readNext(body) ?? "/account",
      orderToken,
    });

    if (!exists) await attachOrderToken(serviceDb(), link.userId, orderToken);

    const rendered = renderAuthLinkEmail({ confirmUrl: link.confirmUrl, purpose: "magiclink" });
    const mailed = await sendAuthLink(email, rendered);
    if (!mailed.sent) throw new HttpError("We couldn't send the email", 503);
    return json({ sent: true });
  });
}
