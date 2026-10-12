import { MOCK_TOKEN } from "@/lib/flow/session";
import { getOrderByHash } from "./db";
import { publicOrderFound } from "./public-order";
import { serviceDb } from "./storage";

/** Request-time existence check. Invalid and unknown links are both missing. */
export async function publicOrderExists(token: string): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_FLOW_MOCK === "1" && token === MOCK_TOKEN) return true;
  return publicOrderFound(token, (tokenHash) => getOrderByHash(serviceDb(), tokenHash));
}
