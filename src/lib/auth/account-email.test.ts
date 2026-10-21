import { describe, expect, it, vi } from "vitest";
import { changeAccountEmail, type AccountEmailUpdate } from "./account-email";

function update(result: Awaited<ReturnType<AccountEmailUpdate>>): AccountEmailUpdate {
  return vi.fn(async () => result);
}

describe("changeAccountEmail", () => {
  it("rejects a missing or malformed address before calling Supabase", async () => {
    const updateUser = update({ data: { user: null }, error: null });
    expect(await changeAccountEmail(updateUser, "ada@example.com", " ")).toEqual({
      ok: false,
      error: "Enter your email.",
    });
    expect(await changeAccountEmail(updateUser, "ada@example.com", "ada")).toEqual({
      ok: false,
      error: "Enter a valid email.",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does not call updateUser when the address is unchanged", async () => {
    const updateUser = update({ data: { user: null }, error: null });
    expect(await changeAccountEmail(updateUser, "Ada@example.com", " ada@example.com ")).toEqual({
      ok: false,
      error: "That is already the email on this account.",
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("passes the new address to updateUser and keeps the current one while confirmation is pending", async () => {
    const updateUser = update({
      data: { user: { email: "ada@example.com", new_email: "new@example.com" } },
      error: null,
    });
    const result = await changeAccountEmail(updateUser, "ada@example.com", "new@example.com");
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.com" });
    expect(result).toEqual({
      ok: true,
      email: "ada@example.com",
      pendingConfirmation: true,
      message: "Check new@example.com to confirm this change. This page still uses ada@example.com until then.",
    });
  });

  it("uses the confirmed address when updateUser applies it immediately", async () => {
    const updateUser = update({
      data: { user: { email: "new@example.com", new_email: null } },
      error: null,
    });
    expect(await changeAccountEmail(updateUser, "ada@example.com", "new@example.com")).toEqual({
      ok: true,
      email: "new@example.com",
      pendingConfirmation: false,
      message: "",
    });
  });

  it("returns the Supabase error and a configuration error when updateUser throws", async () => {
    const rejected = vi.fn(async () => ({
      data: { user: null },
      error: { message: "A user with this email address has already been registered" },
    }));
    expect(await changeAccountEmail(rejected, "ada@example.com", "new@example.com")).toEqual({
      ok: false,
      error: "A user with this email address has already been registered",
    });

    const thrown = vi.fn(async () => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });
    expect(await changeAccountEmail(thrown, "ada@example.com", "new@example.com")).toEqual({
      ok: false,
      error: "Auth is not configured.",
    });
  });
});
