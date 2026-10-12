import { hashOrderToken, isOrderToken } from "./token";

/** Token segment of `/order/:token` or `/preview/:id`. The demo preview is not an order. */
export function publicOrderSegment(pathname: string): string | null {
  const order = /^\/order\/([^/]+)\/?$/.exec(pathname);
  if (order?.[1]) return decodeURIComponent(order[1]);
  const preview = /^\/preview\/([^/]+)\/?$/.exec(pathname);
  if (preview?.[1] && preview[1] !== "demo") return decodeURIComponent(preview[1]);
  return null;
}

/**
 * Whether a public `/order` or `/preview` id is a stored order.
 * Invalid shapes are missing and never reach the lookup.
 */
export async function publicOrderFound(
  token: string,
  lookup: (tokenHash: string) => Promise<unknown | null>,
): Promise<boolean> {
  if (!isOrderToken(token)) return false;
  const order = await lookup(hashOrderToken(token));
  return order != null;
}
