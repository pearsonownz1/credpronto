import { requestOrigin } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { clioCredentials } from "@/lib/clio/config";
import { startClioConnect } from "@/lib/clio/oauth";
import { CLIO_CALLBACK_PATH, parseClioRegion } from "@/lib/clio/regions";
import { redirectPrivate } from "@/lib/clio/response";
import { clioStore } from "@/lib/clio/store";
import { HttpError } from "@/lib/orders/errors";
import { run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function GET(request: Request) {
  return run(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const region = parseClioRegion(url.searchParams.get("region"));
    if (!region) throw new HttpError("Clio region is not supported", 400);
    const location = await startClioConnect({
      userId: user.id,
      region,
      redirectUri: `${requestOrigin(request)}${CLIO_CALLBACK_PATH}`,
      store: clioStore(serviceDb()),
      credentials: clioCredentials(),
    });
    return redirectPrivate(location);
  });
}
