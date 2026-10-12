import { readJson, readNext } from "@/lib/auth/body";
import { callbackUrl, requestOrigin } from "@/lib/auth/redirect";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request).catch((error: unknown) => {
      if (error instanceof HttpError) return {};
      throw error;
    });
    let supabase: Awaited<ReturnType<typeof createClient>>;
    try {
      supabase = await createClient();
    } catch {
      throw new HttpError("Auth is not configured", 503);
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(requestOrigin(request), readNext(body)),
        skipBrowserRedirect: true,
      },
    });
    if (error) throw new HttpError(error.message, 400);
    if (!data.url) throw new HttpError("Google sign-in did not return a URL", 502);
    return json({ url: data.url });
  });
}
