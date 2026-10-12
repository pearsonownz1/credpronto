import { describe, expect, it } from "vitest";
import { generateOrderToken, hashOrderToken } from "./token";
import { publicOrderFound, publicOrderSegment } from "./public-order";

describe("public order pages", () => {
  it("treats a short or punctuated id as missing without a lookup", async () => {
    const lookup = async () => {
      throw new Error("lookup should not run");
    };

    expect(await publicOrderFound("not-a-real-order", lookup)).toBe(false);
    expect(await publicOrderFound("bad id!", lookup)).toBe(false);
    expect(await publicOrderFound("", lookup)).toBe(false);
  });

  it("404s a well-formed token that is not stored", async () => {
    const token = generateOrderToken();
    const seen: string[] = [];

    const found = await publicOrderFound(token, async (tokenHash) => {
      seen.push(tokenHash);
      return null;
    });

    expect(found).toBe(false);
    expect(seen).toEqual([hashOrderToken(token)]);
  });

  it("keeps a stored order", async () => {
    const token = generateOrderToken();
    const found = await publicOrderFound(token, async () => ({ id: "order" }));
    expect(found).toBe(true);
  });

  it("reads order and preview ids and leaves the demo preview alone", () => {
    expect(publicOrderSegment("/order/abc")).toBe("abc");
    expect(publicOrderSegment("/order/abc/")).toBe("abc");
    expect(publicOrderSegment("/preview/abc")).toBe("abc");
    expect(publicOrderSegment("/preview/demo")).toBeNull();
    expect(publicOrderSegment("/preview/demo/extra")).toBeNull();
    expect(publicOrderSegment("/translate")).toBeNull();
  });
});
