import { afterEach, describe, expect, it } from "vitest";
import {
  GCS_PIN_COOKIE,
  GCS_PIN_HEADER,
  assertGcsPin,
  gcsPinCookieHeader,
  gcsPinCookieMatches,
  gcsPinSessionToken,
  gcsTranslatePin,
  pinIsValid,
  requestHasGcsPin,
} from "./pin";
import { POST } from "@/app/api/gcs/pin/route";

const original = process.env.GCS_TRANSLATE_PIN;

afterEach(() => {
  if (original === undefined) delete process.env.GCS_TRANSLATE_PIN;
  else process.env.GCS_TRANSLATE_PIN = original;
});

function headers(values: Record<string, string | null>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

describe("GCS translate PIN", () => {
  it("unlocks 123456 and rejects a wrong PIN", () => {
    delete process.env.GCS_TRANSLATE_PIN;
    expect(gcsTranslatePin()).toBe("123456");
    expect(pinIsValid("123456")).toBe(true);
    expect(pinIsValid(" 123456 ")).toBe(true);
    expect(pinIsValid("000000")).toBe(false);
    expect(pinIsValid("12345")).toBe(false);
    expect(pinIsValid("")).toBe(false);
    expect(pinIsValid(null)).toBe(false);
  });

  it("reads a configured PIN from the environment", () => {
    process.env.GCS_TRANSLATE_PIN = "654321";
    expect(pinIsValid("654321")).toBe(true);
    expect(pinIsValid("123456")).toBe(false);
    expect(gcsPinCookieMatches(gcsPinSessionToken())).toBe(true);
    expect(gcsPinCookieMatches(gcsPinSessionToken("123456"))).toBe(false);
  });

  it("accepts the session cookie or the PIN header and rejects everyone else", () => {
    delete process.env.GCS_TRANSLATE_PIN;
    const cookie = `${GCS_PIN_COOKIE}=${gcsPinSessionToken()}`;
    expect(requestHasGcsPin({ headers: headers({ cookie }) })).toBe(true);
    expect(requestHasGcsPin({ headers: headers({ [GCS_PIN_HEADER]: "123456" }) })).toBe(true);
    expect(requestHasGcsPin({ headers: headers({ cookie: `${GCS_PIN_COOKIE}=nope` }) })).toBe(false);
    expect(requestHasGcsPin({ headers: headers({ [GCS_PIN_HEADER]: "000000" }) })).toBe(false);
    expect(requestHasGcsPin({ headers: headers({}) })).toBe(false);
    expect(() => assertGcsPin({ headers: headers({}) })).toThrow(/PIN/);
    try {
      assertGcsPin({ headers: headers({}) });
    } catch (error) {
      expect(error).toMatchObject({ status: 401 });
    }
    expect(() => assertGcsPin({ headers: headers({ cookie }) })).not.toThrow();
  });
});

describe("POST /api/gcs/pin", () => {
  it("sets a long-lived cookie for 123456 and returns 401 for a wrong PIN", async () => {
    delete process.env.GCS_TRANSLATE_PIN;
    const wrong = await POST(
      new Request("https://translate.gcs.org/api/gcs/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "000000" }),
      }),
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: expect.stringMatching(/PIN/i) });
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await POST(
      new Request("https://translate.gcs.org/api/gcs/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: "123456" }),
      }),
    );
    expect(right.status).toBe(200);
    expect(await right.json()).toEqual({ ok: true });
    const setCookie = right.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${GCS_PIN_COOKIE}=${gcsPinSessionToken()}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=2592000");
    expect(gcsPinCookieHeader()).toContain("Max-Age=2592000");
  });
});
