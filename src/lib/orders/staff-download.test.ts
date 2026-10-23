import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as staff from "./staff";
import * as storage from "./storage";
import {
  STAFF_DOWNLOAD_AUDIT_TABLE,
  STAFF_DOWNLOAD_URL_SECONDS,
  listStaffOrderFiles,
  staffDownloadFile,
  staffOrderFiles,
} from "./staff-download";
import type { DeliveryRecord, OrderRecord } from "./types";

const orderId = "9b80cd30-0000-4000-8000-000000000000";
const order = {
  id: orderId,
  finalTranslationPath: `${orderId}/translation.pdf`,
  certificationPath: `${orderId}/translation.pdf`,
  serviceFiles: { diploma: `${orderId}/diploma.pdf`, course_by_course: `${orderId}/course_by_course.pdf` },
} as OrderRecord;
const delivery = { finalPath: `${orderId}/evaluation.pdf`, certificationPath: `${orderId}/evaluation.pdf` } as DeliveryRecord;

function fakeDb(insertError: { message: string } | null = null) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi.fn().mockReturnValue({ insert });
  return { handle: { from } as unknown as db.Db, from, insert };
}

describe("staffOrderFiles", () => {
  it("lists the delivered package, each report and the translation once each", () => {
    expect(staffOrderFiles(order, delivery)).toEqual([
      { kind: "delivered", path: `${orderId}/evaluation.pdf`, filename: "evaluation.pdf" },
      { kind: "diploma", path: `${orderId}/diploma.pdf`, filename: "diploma.pdf" },
      { kind: "course_by_course", path: `${orderId}/course_by_course.pdf`, filename: "course_by_course.pdf" },
      { kind: "translation", path: `${orderId}/translation.pdf`, filename: "translation.pdf" },
    ]);
  });

  it("drops paths outside the order folder", () => {
    const files = staffOrderFiles(
      { ...order, finalTranslationPath: "other-order/x.pdf", certificationPath: `${orderId}/../x.pdf`, serviceFiles: null },
      null,
    );
    expect(files).toEqual([]);
  });
});

describe("staff download", () => {
  let fake: ReturnType<typeof fakeDb>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake = fakeDb();
    vi.spyOn(staff, "requireStaff").mockResolvedValue({
      db: fake.handle,
      userId: "staff-1",
      role: "admin",
      email: "qa@credpronto.com",
    });
    vi.spyOn(db, "getOrderById").mockResolvedValue(order);
    vi.spyOn(db, "getDelivery").mockResolvedValue(delivery);
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://signed.example/x");
  });

  it("requires staff", async () => {
    vi.spyOn(staff, "requireStaff").mockRejectedValue(Object.assign(new Error("Staff access required"), { status: 403 }));
    await expect(listStaffOrderFiles(orderId)).rejects.toThrow(/Staff/);
    await expect(staffDownloadFile(orderId, { path: `${orderId}/diploma.pdf` })).rejects.toThrow(/Staff/);
    expect(storage.signedObjectUrl).not.toHaveBeenCalled();
  });

  it("logs who pulled which file, then signs a short-lived URL from the private bucket", async () => {
    const result = await staffDownloadFile(orderId, { path: `${orderId}/diploma.pdf` });
    expect(fake.from).toHaveBeenCalledWith(STAFF_DOWNLOAD_AUDIT_TABLE);
    expect(fake.insert).toHaveBeenCalledWith({
      staff_user_id: "staff-1",
      staff_email: "qa@credpronto.com",
      order_id: orderId,
      bucket: "finals",
      file_path: `${orderId}/diploma.pdf`,
      file_kind: "diploma",
    });
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(
      fake.handle,
      "finals",
      `${orderId}/diploma.pdf`,
      STAFF_DOWNLOAD_URL_SECONDS,
      { download: "diploma.pdf" },
    );
    expect(STAFF_DOWNLOAD_URL_SECONDS).toBeLessThanOrEqual(60);
    expect(result).toEqual({
      url: "https://signed.example/x",
      filename: "diploma.pdf",
      kind: "diploma",
      expiresInSeconds: STAFF_DOWNLOAD_URL_SECONDS,
    });
  });

  it("refuses a path that is not on the order and logs nothing", async () => {
    await expect(staffDownloadFile(orderId, { path: "someone-else/report.pdf" })).rejects.toMatchObject({ status: 404 });
    await expect(staffDownloadFile(orderId, {})).rejects.toMatchObject({ status: 400 });
    expect(fake.insert).not.toHaveBeenCalled();
    expect(storage.signedObjectUrl).not.toHaveBeenCalled();
  });

  it("refuses the download when the audit row cannot be written", async () => {
    fake = fakeDb({ message: "relation does not exist" });
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: fake.handle, userId: "staff-1", role: "admin" });
    await expect(staffDownloadFile(orderId, { path: `${orderId}/evaluation.pdf` })).rejects.toMatchObject({ status: 503 });
    expect(storage.signedObjectUrl).not.toHaveBeenCalled();
  });

  it("404s an unknown order", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(null);
    await expect(listStaffOrderFiles(orderId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("staff_file_downloads migration", () => {
  it("creates the audit table with RLS on and no client write policy", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261023140000_staff_file_downloads.sql", "utf8");
    expect(sql).toMatch(/create table if not exists public\.staff_file_downloads/);
    for (const column of ["staff_user_id", "staff_email", "order_id", "file_path", "downloaded_at"]) {
      expect(sql).toContain(column);
    }
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/for (insert|update|delete|all)/);
  });
});
