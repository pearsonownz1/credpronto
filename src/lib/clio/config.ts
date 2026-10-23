import { HttpError } from "@/lib/orders/errors";

type Env = Record<string, string | undefined>;

export type ClioCredentials = {
  clientId: string;
  clientSecret: string;
};

export function clioCredentials(env: Env = process.env): ClioCredentials {
  const clientId = env.CLIO_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.CLIO_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) throw new HttpError("Clio is not configured", 503);
  return { clientId, clientSecret };
}
