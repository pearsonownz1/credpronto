import { createBrowserClient } from "@supabase/ssr";
import { readPublicSupabaseEnv } from "./env";

export function createClient() {
  const { url, key } = readPublicSupabaseEnv();
  return createBrowserClient(url, key);
}
