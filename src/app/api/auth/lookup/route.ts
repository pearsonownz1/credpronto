import { readEmail, readJson } from "@/lib/auth/body";
import { emailHasAccount } from "@/lib/auth/email-link";
import { json, run } from "@/lib/orders/http";

export async function POST(request: Request) {
  return run(async () => {
    const email = readEmail(await readJson(request));
    return json({ exists: await emailHasAccount(email) });
  });
}
