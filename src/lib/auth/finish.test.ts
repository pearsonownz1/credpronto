import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/orders/db";
import { generateOrderToken } from "@/lib/orders/token";
import { finishAuthenticatedUser } from "./finish";

vi.mock("@/lib/orders/storage", () => ({
  serviceDb: () => ({ kind: "service" }),
}));

const instantUser = {
  id: "user-1",
  email: "ada@example.com",
  email_confirmed_at: "2026-10-21T00:00:00Z",
  app_metadata: { email_verified: false },
};

describe("email claiming after instant sign-up", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("skips email claiming until a magic link or confirm flow marks the inbox verified", async () => {
    const claim = vi.spyOn(db, "claimOrdersByCustomerEmail").mockResolvedValue(["other-guest-order"]);
    vi.spyOn(db, "getOrderByHash").mockResolvedValue({ id: "token-order", userId: null } as never);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "insertEvent").mockResolvedValue({} as never);

    await expect(finishAuthenticatedUser(instantUser, generateOrderToken())).resolves.toEqual([]);
    expect(claim).not.toHaveBeenCalled();

    await expect(
      finishAuthenticatedUser(
        { ...instantUser, app_metadata: { email_verified: true } },
        generateOrderToken(),
      ),
    ).resolves.toEqual(["other-guest-order"]);
    expect(claim).toHaveBeenCalledWith(expect.anything(), "user-1", "ada@example.com");
  });
});
