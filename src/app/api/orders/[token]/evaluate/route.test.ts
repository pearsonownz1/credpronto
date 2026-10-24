import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/orders/errors";
import { evaluateGcsOrder } from "@/lib/orders/gcs-evaluate";
import { POST } from "./route";

vi.mock("@/lib/orders/gcs-evaluate", () => ({
  evaluateGcsOrder: vi.fn(),
}));

const payload = {
  evaluation: {
    url: "https://signed.example/eval.pdf",
    pageCount: 1,
    pages: [{ number: 1, widthPt: 612, heightPt: 792 }],
    kind: "diploma" as const,
  },
};

describe("POST /api/orders/[token]/evaluate", () => {
  beforeEach(() => {
    vi.mocked(evaluateGcsOrder).mockReset();
  });

  it("returns the evaluation for the token", async () => {
    vi.mocked(evaluateGcsOrder).mockResolvedValue(payload);
    const response = await POST(new Request("http://localhost/api/orders/tok/evaluate"), {
      params: Promise.resolve({ token: "tok" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(evaluateGcsOrder).toHaveBeenCalledWith("tok");
  });

  it("passes through a rejection for a non-GCS order", async () => {
    vi.mocked(evaluateGcsOrder).mockRejectedValue(new HttpError("Evaluation is not available for this order", 403));
    const response = await POST(new Request("http://localhost/api/orders/tok/evaluate"), {
      params: Promise.resolve({ token: "tok" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Evaluation is not available for this order" });
  });
});
