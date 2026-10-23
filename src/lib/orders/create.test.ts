import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { resolveOrderCustomer } from "./create";

const session = { id: "user-1", email: "ada@example.com" };

describe("resolveOrderCustomer", () => {
  it("uses the session email and user id, and ignores a different body email", () => {
    expect(
      resolveOrderCustomer({
        session,
        bodyEmail: "eve@example.com",
      }),
    ).toEqual({ email: "ada@example.com", userId: "user-1" });
  });

  it("rejects a session with no email instead of accepting the body email", () => {
    expect(() =>
      resolveOrderCustomer({
        session: { id: "user-1", email: null },
        bodyEmail: "ada@example.com",
      }),
    ).toThrow(HttpError);
    expect(() =>
      resolveOrderCustomer({
        session: { id: "user-1", email: "not-an-email" },
        bodyEmail: "ada@example.com",
      }),
    ).toThrow(HttpError);
  });

  it("keeps a guest email and allows a quote with none", () => {
    expect(resolveOrderCustomer({ session: null, bodyEmail: " ada@example.com " })).toEqual({
      email: "ada@example.com",
      userId: null,
    });
    expect(resolveOrderCustomer({ session: null, bodyEmail: null })).toEqual({ email: null, userId: null });
    expect(resolveOrderCustomer({ session: null, bodyEmail: "" })).toEqual({ email: null, userId: null });
    expect(resolveOrderCustomer({ session: null, bodyEmail: "   " })).toEqual({ email: null, userId: null });
    expect(() => resolveOrderCustomer({ session: null, bodyEmail: "not-an-email" })).toThrow(HttpError);
  });
});
