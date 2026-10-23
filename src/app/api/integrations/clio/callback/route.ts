import { requestOrigin } from "@/lib/auth/redirect";
import { optionalUser } from "@/lib/auth/session";
import { actionTarget, registerOrderTranslationAction } from "@/lib/clio/actions";
import { clioCredentials } from "@/lib/clio/config";
import { completeClioOAuthCallback } from "@/lib/clio/oauth";
import { safeClioMessage } from "@/lib/clio/redact";
import { redirectPrivate } from "@/lib/clio/response";
import { clioStore } from "@/lib/clio/store";
import { serviceDb } from "@/lib/orders/storage";

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  try {
    const session = await optionalUser();
    const credentials = clioCredentials();
    const result = await completeClioOAuthCallback({
      requestUrl: request.url,
      origin,
      sessionUserId: session?.id ?? null,
      store: clioStore(serviceDb()),
      fetchImpl: fetch,
      credentials,
      registerAction: (connection) =>
        registerOrderTranslationAction({
          fetchImpl: fetch,
          connection,
          targetUrl: actionTarget(origin),
        }),
    });
    return redirectPrivate(result.redirectTo);
  } catch (error) {
    console.error(safeClioMessage(error));
    return redirectPrivate(`${origin}/dashboard/integrations?clio=error`);
  }
}
