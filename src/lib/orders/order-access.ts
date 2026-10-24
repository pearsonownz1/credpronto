import { cookies } from "next/headers";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { GCS_PIN_COOKIE, gcsPinCookieMatches } from "@/lib/gcs/pin";
import { getOrderById, getPreviewOrderById, requireOrderByHash, requirePreviewOrderByHash } from "./db";
import { HttpError } from "./errors";
import { isGcsOrder } from "./gcs";
import { serviceDb, type Db } from "./storage";
import { assertOrderTokenShape, hashOrderToken, isOrderId } from "./token";

type OwnedOrder = { userId: string | null; brand?: string | null };

/**
 * The translate desk stores the PIN in an httpOnly cookie. A GCS order opened
 * by its id (the sidebar, or a UUID pasted into `/gcs-translate`) is allowed
 * when that cookie matches, with no Supabase session.
 * Outside a request (unit tests, static analysis) the cookie read fails closed.
 */
async function gcsPinCookieAuthorized(): Promise<boolean> {
  try {
    const jar = await cookies();
    return gcsPinCookieMatches(jar.get(GCS_PIN_COOKIE)?.value);
  } catch {
    return false;
  }
}

/**
 * Dashboard ids still start the session check and the order read together.
 * A valid GCS PIN authorizes `brand = gcs` even when `requireUser()` rejects.
 * Any other brand, or a GCS order with no PIN, keeps the owner check.
 */
async function orderById<T extends OwnedOrder>(
  token: string,
  load: (db: Db, orderId: string) => Promise<T | null>,
): Promise<{ db: Db; order: T; token: string }> {
  const db = serviceDb();
  const pinPromise = gcsPinCookieAuthorized();
  const userPromise = requireUser().then(
    (user: AuthUser) => ({ user, error: null as unknown }),
    (error: unknown) => ({ user: null as AuthUser | null, error }),
  );
  const [pin, session, order] = await Promise.all([pinPromise, userPromise, load(db, token)]);
  if (order && isGcsOrder(order) && pin) return { db, order, token };
  if (session.error) throw session.error;
  if (!order || !session.user || order.userId !== session.user.id) throw new HttpError("Order not found", 404);
  return { db, order, token };
}

/** Email-link token, the order id for its signed-in owner, or a GCS id with the PIN cookie. */
export async function orderForToken(token: string) {
  if (isOrderId(token)) return orderById(token, getOrderById);
  const db = serviceDb();
  assertOrderTokenShape(token);
  const order = await requireOrderByHash(db, hashOrderToken(token));
  return { db, order, token };
}

/**
 * Same credential check as `orderForToken`, reading only the preview columns.
 * A dashboard id checks the session and the owner together. A link token is still
 * rejected unless it matches `public_token_hash`. A GCS id with the PIN cookie
 * skips the session.
 */
export async function orderForPreview(token: string) {
  if (isOrderId(token)) return orderById(token, getPreviewOrderById);
  const db = serviceDb();
  assertOrderTokenShape(token);
  const order = await requirePreviewOrderByHash(db, hashOrderToken(token));
  return { db, order, token };
}
