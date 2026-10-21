import { customerEmailError } from "@/lib/flow/customer-email";

export type AccountEmailUser = {
  email?: string | null;
  new_email?: string | null;
};

export type AccountEmailUpdate = (attributes: { email: string }) => Promise<{
  data: { user: AccountEmailUser | null };
  error: { message: string } | null;
}>;

export type AccountEmailChange =
  | { ok: true; email: string; pendingConfirmation: boolean; message: string }
  | { ok: false; error: string };

/**
 * Ask Supabase to change the signed-in user's email.
 * updateUser may still email a confirmation; the address on the session stays
 * until that confirmation lands.
 */
export async function changeAccountEmail(
  updateUser: AccountEmailUpdate,
  currentEmail: string,
  nextEmail: string,
): Promise<AccountEmailChange> {
  const problem = customerEmailError(nextEmail);
  if (problem) return { ok: false, error: problem };
  const email = nextEmail.trim();
  if (email.toLowerCase() === currentEmail.trim().toLowerCase()) {
    return { ok: false, error: "That is already the email on this account." };
  }

  let result: Awaited<ReturnType<AccountEmailUpdate>>;
  try {
    result = await updateUser({ email });
  } catch {
    return { ok: false, error: "Auth is not configured." };
  }
  if (result.error) return { ok: false, error: result.error.message };

  const confirmed = result.data.user?.email?.trim() || "";
  const pendingAddress = result.data.user?.new_email?.trim() || "";
  const applied = confirmed.toLowerCase() === email.toLowerCase() && !pendingAddress;
  if (!applied) {
    return {
      ok: true,
      email: currentEmail,
      pendingConfirmation: true,
      message: `Check ${email} to confirm this change. This page still uses ${currentEmail} until then.`,
    };
  }
  return { ok: true, email: confirmed, pendingConfirmation: false, message: "" };
}
