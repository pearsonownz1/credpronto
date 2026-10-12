import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { reportedError, run } from "./http";

describe("reportedError", () => {
  it("keeps the failing filename and drops the server path", () => {
    const error = new Error(
      "ENOENT: no such file or directory, open '/var/task/src/lib/orders/pdf/NotoSans-Italic.ttf'",
    );
    expect(reportedError(error)).toBe("ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'");
  });
});

describe("run", () => {
  it("returns the underlying error instead of a generic 500", async () => {
    const response = await run(async () => {
      throw new Error("ENOENT: no such file or directory, open '/var/task/src/lib/orders/pdf/NotoSans-Italic.ttf'");
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'",
    });
  });

  it("keeps an HttpError status and message", async () => {
    const response = await run(async () => {
      throw new HttpError("Only a paid order can be certified", 409);
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Only a paid order can be certified" });
  });
});
