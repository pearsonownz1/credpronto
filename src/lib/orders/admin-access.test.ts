import { afterEach, describe, expect, it, vi } from "vitest";
import { requireStaffOrService } from "./admin-access";
import { HttpError } from "./errors";
import * as staff from "./staff";
import * as storage from "./storage";
import type { Db } from "./storage";

describe("staff or service auth", () => {
  const previous = process.env.CRON_SECRET;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  it("accepts the service bearer without a staff session", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const db = {} as Db;
    vi.spyOn(storage, "serviceDb").mockReturnValue(db);
    const session = vi.spyOn(staff, "requireStaff").mockRejectedValue(new HttpError("Sign in required", 401));
    const request = new Request("http://localhost/api/admin/corrections", {
      headers: { authorization: "Bearer cron-test-secret" },
    });
    await expect(requireStaffOrService(request)).resolves.toEqual({ db, actor: "service" });
    expect(session).not.toHaveBeenCalled();
  });

  it("uses the staff session when the bearer does not match", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const db = {} as Db;
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db, userId: "staff-1", role: "admin" });
    const request = new Request("http://localhost/api/admin/corrections", {
      headers: { authorization: "Bearer not-the-secret" },
    });
    await expect(requireStaffOrService(request)).resolves.toEqual({ db, actor: "staff" });
  });
});
