import { describe, expect, it, vi } from "vitest";
import { CHECKOUT_IMAGE_SECONDS } from "./checkout-preview";
import { checkoutPreviewImageUrl } from "./checkout-image";
import type { Db } from "./storage";

function storageDb(impl: Record<string, unknown>): Db {
  return { storage: { from: () => impl } } as unknown as Db;
}

describe("checkout preview image url", () => {
  it("reuses an existing png and signs it for 25 hours", async () => {
    const signed: { path?: string; expires?: number } = {};
    const db = storageDb({
      list: async () => ({ data: [{ id: "obj", name: "already.png" }], error: null }),
      createSignedUrl: async (path: string, expires: number) => {
        signed.path = path;
        signed.expires = expires;
        return { data: { signedUrl: "https://files.example/already.png" }, error: null };
      },
      download: async () => {
        throw new Error("existing png should be reused");
      },
    });

    await expect(checkoutPreviewImageUrl(db, "order-1", "order-1/preview-v1.pdf")).resolves.toBe(
      "https://files.example/already.png",
    );
    expect(signed).toEqual({
      path: "checkout-previews/order-1/already.png",
      expires: CHECKOUT_IMAGE_SECONDS,
    });
  });

  it("logs and returns null when the watermarked preview cannot be used", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = storageDb({
      list: async () => {
        throw new Error("storage should not be read");
      },
    });

    await expect(checkoutPreviewImageUrl(db, "order-1", "order-1/translation-v1.pdf")).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("watermarked preview"));
    error.mockRestore();
  });

  it("logs and returns null when storage fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = storageDb({
      list: async () => ({ data: null, error: { message: "storage down" } }),
    });

    await expect(checkoutPreviewImageUrl(db, "order-1", "order-1/preview-v1.pdf")).resolves.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("storage down"));
    error.mockRestore();
  });
});
