import { getOrderByHash } from "./db";
import { publicOrderFound } from "./public-order";
import { serviceDb } from "./storage";

/** Request-time existence check. Invalid and unknown links are both missing. */
export async function publicOrderExists(token: string): Promise<boolean> {
  return publicOrderFound(token, (tokenHash) => getOrderByHash(serviceDb(), tokenHash));
}
