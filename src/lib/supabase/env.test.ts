import { describe, expect, it } from "vitest";
import { readPublicSupabaseEnv, readServiceRoleEnv } from "./env";

describe("supabase env", () => {
  it("reads the public url and anon key", () => {
    expect(
      readPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      key: "anon-key",
    });
  });

  it("falls back to the publishable key when the anon key is absent", () => {
    expect(
      readPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }).key,
    ).toBe("publishable-key");
  });

  it("reads the service role key without a public anon key", () => {
    expect(
      readServiceRoleEnv({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      key: "service-role",
    });
  });

  it("throws when required names are missing", () => {
    expect(() => readPublicSupabaseEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => readServiceRoleEnv({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
