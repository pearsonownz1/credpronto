import { readEmail, readJson, readNext } from "@/lib/auth/body";
import { callbackUrl, requestOrigin } from "@/lib/auth/redirect";
import { json, run } from "@/lib/orders/http";
import { HttpError } from "@/lib/orders/errors";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    const email = readEmail(body);
    let supabase: Awaited<ReturnType<typeof createClient>>;
    try {
      supabase = await createClient();
    } catch {
      throw new HttpError("Auth is not configured", 503);
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl(requestOrigin(request), readNext(body)),
      },
    });
    if (error) throw new HttpError(error.message, 400);
    return json({ sent: true });
  });
}
