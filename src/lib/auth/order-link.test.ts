import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "@/lib/orders/db";
import { generateOrderToken } from "@/lib/orders/token";
import { attachOrderToken } from "./order-link";

describe("attachOrderToken", () => {
  const token = generateOrderToken();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ties an unowned order to the account without storing the token", async () => {
    vi.spyOn(db, "getOrderByHash").mockResolvedValue({ id: "order-1", userId: null } as never);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    const event = vi.spyOn(db, "insertEvent").mockResolvedValue({} as never);

    await expect(attachOrderToken({} as never, "user-1", token)).resolves.toBe("order-1");

    expect(update).toHaveBeenCalledWith(expect.anything(), "order-1", { user_id: "user-1" });
    expect(event).toHaveBeenCalledWith(expect.anything(), "order-1", "account_linked", { userId: "user-1" });
    expect(JSON.stringify(event.mock.calls)).not.toContain(token);
  });

  it("leaves an order that another account already owns", async () => {
    vi.spyOn(db, "getOrderByHash").mockResolvedValue({ id: "order-1", userId: "other" } as never);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);

    await expect(attachOrderToken({} as never, "user-1", token)).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores a value that is not an order token", async () => {
    const lookup = vi.spyOn(db, "getOrderByHash");
    await expect(attachOrderToken({} as never, "user-1", "not a token")).resolves.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
