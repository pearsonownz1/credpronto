import { createClient } from "@/lib/supabase/server";
import { HttpError } from "./errors";
import { serviceDb, type Db } from "./storage";

export async function requireStaff(): Promise<{ db: Db; userId: string; role: string }> {
  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch {
    throw new HttpError("Auth is not configured", 503);
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError("Sign in required", 401);

  const db = serviceDb();
  const staff = await db.from("staff").select("user_id, role").eq("user_id", data.user.id).maybeSingle();
  if (staff.error) throw new Error(staff.error.message);
  if (staff.data) return { db, userId: data.user.id, role: String(staff.data.role) };

  const profile = await db.from("profiles").select("is_admin").eq("id", data.user.id).maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (profile.data?.is_admin === true) return { db, userId: data.user.id, role: "admin" };

  throw new HttpError("Staff access required", 403);
}

/** deliveries.approved_by references staff. An is_admin profile is recorded there on approval. */
export async function ensureStaffRow(db: Db, userId: string): Promise<void> {
  const existing = await db.from("staff").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return;
  const inserted = await db.from("staff").insert({ user_id: userId, role: "admin" });
  if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message);
}
