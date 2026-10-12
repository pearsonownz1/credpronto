import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import {
  assertCurrentStaffFinal,
  assertPdfBytes,
  listStaffFinals,
  parseStaffFinalName,
  staffFinalObjectName,
  uploadReviewedFinal,
} from "./finals";
import * as storage from "./storage";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const uploaderId = "11111111-2222-4333-8444-555555555555";
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

const order = {
  id: orderId,
  finalTranslationPath: `${orderId}/translation-v1.pdf`,
  certificationPath: `${orderId}/certification-v1.pdf`,
} as OrderRecord;

describe("staff final versions", () => {
  const stored: string[] = [];

  beforeEach(() => {
    stored.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(storage, "listObjectNames").mockImplementation(async () => [...stored]);
    vi.spyOn(storage, "uploadObject").mockImplementation(async (_db, bucket, path, bytes, contentType) => {
      expect(bucket).toBe("finals");
      expect(contentType).toBe("application/pdf");
      expect(bytes).toBe(pdf);
      expect(path.startsWith(`${orderId}/staff-final/`)).toBe(true);
      expect(path).not.toContain("translation-v");
      stored.push(path.split("/").pop() ?? "");
    });
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
  });

  it("round-trips the uploader and timestamp in the object name", () => {
    const uploadedAt = "2026-10-12T08:13:44.123Z";
    const name = staffFinalObjectName(uploadedAt, uploaderId);
    expect(parseStaffFinalName(name)).toEqual({ uploadedAt, uploadedBy: uploaderId });
    expect(parseStaffFinalName("translation-v1.pdf")).toBeNull();
  });

  it("rejects a file that is not a PDF", () => {
    expect(() => assertPdfBytes(new TextEncoder().encode("not a pdf"))).toThrow(/Upload a PDF/);
    expect(() => assertPdfBytes(new Uint8Array())).toThrow(/Upload a PDF/);
  });

  it("stores each upload as a new finals object and keeps the earlier version", async () => {
    const first = await uploadReviewedFinal({} as db.Db, order, uploaderId, pdf);
    const second = await uploadReviewedFinal({} as db.Db, order, uploaderId, pdf);

    expect(stored).toHaveLength(2);
    expect(stored[0]).not.toBe(stored[1]);
    expect(first.versions).toHaveLength(1);
    expect(first.versions[0]).toMatchObject({ version: 1, uploadedBy: uploaderId, current: true });
    expect(second.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(second.versions[0]?.current).toBe(true);
    expect(second.versions[1]?.current).toBe(false);
    expect(second.versions[1]?.path).toBe(first.versions[0]?.path);
    expect(db.updateOrder).toHaveBeenLastCalledWith(expect.anything(), orderId, {
      final_translation_path: second.versions[0]?.path,
    });
    expect(db.updateDelivery).not.toHaveBeenCalled();
  });

  it("points an existing delivery at the new current final", async () => {
    vi.spyOn(db, "getDelivery").mockResolvedValue({ orderId, finalPath: "old.pdf" } as Awaited<
      ReturnType<typeof db.getDelivery>
    >);
    const saved = await uploadReviewedFinal({} as db.Db, order, uploaderId, pdf);
    expect(db.updateDelivery).toHaveBeenCalledWith(expect.anything(), orderId, {
      final_path: saved.versions[0]?.path,
    });
  });

  it("refuses approval while the current final is still the AI file", async () => {
    stored.push("20261012T081344123Z--11111111-2222-4333-8444-555555555555.pdf");
    await expect(assertCurrentStaffFinal({} as db.Db, order)).rejects.toThrow(
      "Upload the reviewed final PDF first",
    );

    const versions = await listStaffFinals({} as db.Db, orderId, order.finalTranslationPath);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.current).toBe(false);
    expect(versions[0]?.uploadedBy).toBe(uploaderId);
    expect(versions[0]?.uploadedAt).toBe("2026-10-12T08:13:44.123Z");

    const currentPath = versions[0]?.path ?? "";
    const current = await assertCurrentStaffFinal({} as db.Db, {
      ...order,
      finalTranslationPath: currentPath,
    });
    expect(current.path).toBe(currentPath);
    expect(current.current).toBe(true);
  });
});
