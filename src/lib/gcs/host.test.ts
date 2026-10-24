import { describe, expect, it } from "vitest";
import {
  GCS_TRANSLATE_PATH,
  gcsFlowRequest,
  gcsRewriteTarget,
  isGcsTranslateHost,
  isPreservedGcsPath,
  requestHost,
} from "./host";

describe("GCS host routing", () => {
  it("reads the forwarded host before host, and drops the port", () => {
    expect(
      requestHost({
        get(name: string) {
          if (name === "x-forwarded-host") return "Translate.GCS.org:443, proxy.internal";
          if (name === "host") return "credpronto.com";
          return null;
        },
      }),
    ).toBe("translate.gcs.org");
    expect(
      requestHost({
        get(name: string) {
          return name === "host" ? "credpronto.com:3000" : null;
        },
      }),
    ).toBe("credpronto.com");
  });

  it("matches translate.gcs.org and hosts that start with that name", () => {
    expect(isGcsTranslateHost("translate.gcs.org")).toBe(true);
    expect(isGcsTranslateHost("translate.gcs.org.cdn.example")).toBe(true);
    expect(isGcsTranslateHost("www.credpronto.com")).toBe(false);
    expect(isGcsTranslateHost("preview.credpronto.com")).toBe(false);
  });

  it("rewrites the GCS home and /translate, and leaves APIs and assets alone", () => {
    const host = "translate.gcs.org";
    expect(gcsRewriteTarget(host, "/")).toBe(GCS_TRANSLATE_PATH);
    expect(gcsRewriteTarget(host, "/translate")).toBe(GCS_TRANSLATE_PATH);
    expect(gcsRewriteTarget(host, "/translate/")).toBe(GCS_TRANSLATE_PATH);
    expect(gcsRewriteTarget(host, GCS_TRANSLATE_PATH)).toBeNull();
    for (const path of [
      "/api/orders",
      "/api/orders/token/download",
      "/api/uploads",
      "/_next/static/chunk.js",
      "/gcs/gcs-logo.png",
      "/favicon.ico",
      "/fonts/noto.woff2",
    ]) {
      expect(isPreservedGcsPath(path)).toBe(true);
      expect(gcsRewriteTarget(host, path)).toBeNull();
    }
  });

  it("serves /gcs-translate on any host and does not rewrite the paid site", () => {
    expect(gcsRewriteTarget("www.credpronto.com", "/")).toBeNull();
    expect(gcsRewriteTarget("www.credpronto.com", "/translate")).toBeNull();
    expect(gcsRewriteTarget("preview-abc.vercel.app", GCS_TRANSLATE_PATH)).toBeNull();
    expect(gcsFlowRequest("www.credpronto.com", GCS_TRANSLATE_PATH)).toBe(true);
    expect(gcsFlowRequest("translate.gcs.org", "/")).toBe(true);
    expect(gcsFlowRequest("www.credpronto.com", "/translate")).toBe(false);
  });
});
