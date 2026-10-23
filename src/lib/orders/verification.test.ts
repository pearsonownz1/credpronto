import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as revokeVerification } from "@/app/api/admin/orders/[id]/verification/route";
import { GET as readVerifyRoute } from "@/app/api/verify/[token]/route";
import { BRAND_NAME, BRAND_STREET } from "./brand";
import { DOWNLOAD_URL_SECONDS } from "./constants";
import * as ordersDb from "./db";
import { HttpError } from "./errors";
import { stampApprovedCover } from "./certification";
import { storeCertifiedTranslation } from "./final-file";
import { renderCertificationPdf } from "./pdf/render";
import { SIGN_ROLE_TRANSLATOR } from "./pdf/signature";
import {
  qrMatrix,
  stampVerificationQr,
  verificationStampPlacement,
  verificationUrl,
  type StampRect,
} from "./pdf/verify-stamp";
import * as staff from "./staff";
import * as storage from "./storage";
import type { Db } from "./storage";
import type { OrderRecord } from "./types";
import {
  finishedPdfPath,
  generateVerificationToken,
  isVerificationToken,
  publicVerification,
  readVerification,
  setVerificationRevoked,
  stampFinishedPdf,
} from "./verification";
import { resetVerifyRate, VERIFY_RATE_MAX } from "./verify-rate-limit";

const orderId = "28492f38-1111-4111-8111-111111111111";
const migrationsDir = path.join(process.cwd(), "supabase", "migrations");

type Row = Record<string, unknown>;

function memoryDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const selects: string[] = [];
  function from(table: string) {
    if (!tables[table]) tables[table] = [];
    const state: {
      filters: Array<(row: Row) => boolean>;
      op: "select" | "insert" | "update";
      patch: Row | null;
      incoming: Row | null;
      mode: "many" | "one";
    } = { filters: [], op: "select", patch: null, incoming: null, mode: "many" };
    const api = {
      select(columns = "*") {
        selects.push(`${table} ${columns}`);
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      is(column: string, value: unknown) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      insert(row: Row) {
        state.op = "insert";
        state.incoming = { ...row };
        return api;
      },
      update(patch: Row) {
        state.op = "update";
        state.patch = patch;
        return api;
      },
      maybeSingle() {
        state.mode = "one";
        return api;
      },
      then(
        onFulfilled: (value: { data: unknown; error: { message: string; code?: string } | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(run()).then(onFulfilled, onRejected);
      },
    };

    function run() {
      const tableRows = tables[table] ?? [];
      if (state.op === "insert" && state.incoming) {
        const row: Row = {
          created_at: "2026-10-23T19:10:00.000Z",
          revoked_at: null,
          revoked_by: null,
          ...state.incoming,
        };
        const duplicateToken = tableRows.some((existing) => existing.token === row.token);
        const duplicateActive = tableRows.some(
          (existing) =>
            existing.order_id === row.order_id &&
            existing.document_type === row.document_type &&
            existing.revoked_at == null &&
            row.revoked_at == null,
        );
        if (duplicateToken || duplicateActive) return { data: null, error: { message: "duplicate", code: "23505" } };
        tableRows.push(row);
        tables[table] = tableRows;
        return { data: row, error: null };
      }
      const found = tableRows.filter((row) => state.filters.every((keep) => keep(row)));
      if (state.op === "update" && state.patch) {
        for (const row of found) Object.assign(row, state.patch);
      }
      if (state.mode === "one") {
        if (found.length > 1) return { data: null, error: { message: "multiple rows" } };
        return { data: found[0] ?? null, error: null };
      }
      return { data: found, error: null };
    }

    return api;
  }
  return { from, tables, selects };
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const extracted = await extractText(await getDocumentProxy(Uint8Array.from(bytes)), { mergePages: true });
  const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : String(extracted.text);
  return text.replace(/\s+/g, "");
}

function orderRow(patch: Row = {}): Row {
  return {
    id: orderId,
    email: "ada@example.com",
    date_of_birth: "1990-01-01",
    shipping_address: "1 Secret Street",
    final_translation_path: `${orderId}/certified-translation-v1.pdf`,
    certification_path: `${orderId}/certified-translation-v1.pdf`,
    ...patch,
  };
}

afterEach(() => {
  resetVerifyRate();
  vi.restoreAllMocks();
});

describe("verification link migration", () => {
  const file = "20261023191000_verification_links.sql";
  const sql = readFileSync(path.join(migrationsDir, file), "utf8");
  const lower = sql.toLowerCase();

  it("is a later unique migration and keeps the token private", () => {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
    const stamps = files.map((name) => name.slice(0, 14));
    expect(files.filter((name) => name.startsWith("20261023191000"))).toEqual([file]);
    expect(stamps.filter((stamp) => stamp === "20261023191000")).toHaveLength(1);
    expect(file.slice(0, 14) > "20261023190000").toBe(true);
    expect(sql).toMatch(/create table public\.verification_links/);
    expect(sql).toMatch(/token text primary key/);
    expect(sql).toMatch(/order_id uuid not null references public\.orders/);
    expect(sql).toMatch(/document_type text not null/);
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(sql).toMatch(/revoked_at timestamptz/);
    expect(sql).toMatch(/revoked_by uuid references auth\.users/);
    expect(sql).toMatch(/char_length\(token\) >= 22/);
    expect(sql).toMatch(/document_type in \('translation', 'evaluation'\)/);
    expect(sql).toMatch(/where revoked_at is null/);
    expect(lower).toMatch(/enable row level security/);
    expect(lower).toMatch(/revoke all on table public\.verification_links from public, anon, authenticated/);
    expect(lower).toMatch(/grant select, insert, update, delete on table public\.verification_links to service_role/);
    expect(lower).not.toMatch(/grant [^;]*to (anon|authenticated)/);
    expect(lower).not.toMatch(/create policy/);
    expect(lower).not.toMatch(/insert into/);
  });
});

describe("verification token", () => {
  it("is url-safe and at least 128 bits", () => {
    const token = generateVerificationToken();
    expect(isVerificationToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url").length).toBeGreaterThanOrEqual(16);
    expect(token).not.toMatch(/[+/=]/);
    expect(isVerificationToken("short")).toBe(false);
    expect(isVerificationToken(`${token}*`)).toBe(false);
  });
});

describe("finished pdf path", () => {
  const translation = `${orderId}/certified-translation-v2.pdf`;
  const evaluation = `${orderId}/evaluation.pdf`;

  it("points a translation and an evaluation at their own finals", () => {
    const order = { finalTranslationPath: translation, certificationPath: translation };
    const delivery = { finalPath: evaluation, certificationPath: evaluation };
    expect(finishedPdfPath({ documentType: "translation", order, delivery })).toBe(translation);
    expect(finishedPdfPath({ documentType: "evaluation", order, delivery })).toBe(evaluation);
  });

  it("uses a published evaluation report when delivery has not stored one yet", () => {
    expect(
      finishedPdfPath({
        documentType: "evaluation",
        order: {
          finalTranslationPath: `${orderId}/evaluation-v3.pdf`,
          certificationPath: `${orderId}/evaluation-v3.pdf`,
        },
        delivery: null,
      }),
    ).toBe(`${orderId}/evaluation-v3.pdf`);
  });
});

describe("qr stamp", () => {
  it("keeps the finder pattern orientation", () => {
    const matrix = qrMatrix(verificationUrl("fixture"));
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    expect(matrix.get(0, 0)).toBe(true);
    expect(matrix.get(0, 6)).toBe(true);
    expect(matrix.get(6, 0)).toBe(true);
    expect(matrix.get(1, 1)).toBe(false);
    expect(matrix.get(2, 2)).toBe(true);
  });

  it("prints the verify url on the finished pdf and reuses the active token", async () => {
    const db = memoryDb();
    const first = await stampFinishedPdf(db as unknown as Db, await blankPdf(), {
      orderId,
      documentType: "translation",
    });
    const second = await stampFinishedPdf(db as unknown as Db, await blankPdf(), {
      orderId,
      documentType: "translation",
    });
    const active = db.tables.verification_links?.filter((row) => row.revoked_at == null) ?? [];
    expect(active).toHaveLength(1);
    const token = String(active[0]?.token);
    const url = verificationUrl(token);
    expect(await pdfText(first)).toContain(url);
    expect(await pdfText(second)).toContain(url);
    expect((await PDFDocument.load(first)).getPageCount()).toBe(1);
  });

  it("keeps page 1 at US Letter, with the QR and URL in the top band", async () => {
    const cover = await renderCertificationPdf({
      orderId: "order-1",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-11",
      clientName: "Alex Example",
      translatorName: "Ada Lovelace",
      documents: [{ name: "example.pdf", sourcePages: 1, translatedPages: 1 }],
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: ["Example page"] }],
    });
    const original = await PDFDocument.load(cover, { updateMetadata: false });
    expect(original.getCreator()).toBe(BRAND_NAME);
    expect(original.getProducer()).toBe(BRAND_NAME);
    const source = original.getPage(0).getSize();
    expect(source).toEqual({ width: 612, height: 792 });
    const font = await original.embedFont(StandardFonts.Helvetica);
    const token = "a".repeat(43);
    const url = verificationUrl(token);
    const placement = verificationStampPlacement(
      source,
      url,
      (text, size) => font.widthOfTextAtSize(text, size),
      qrMatrix(url).size,
    );

    const band: StampRect = { x: 0, y: 720, width: 612, height: 72 };
    const contentRegion: StampRect = { x: 0, y: 0, width: 612, height: 720 };
    expect(placement.page).toEqual({ width: 612, height: 792 });
    expect(placement.band).toEqual(band);
    expect(placement.qr).toEqual({ x: 548, y: 728, width: 56, height: 56 });
    expect(inside(placement.qr, band)).toBe(true);
    expect(inside(placement.label, band)).toBe(true);
    expect(intersects(placement.label, placement.qr)).toBe(false);
    expect(placement.label.x).toBeLessThan(placement.qr.x);
    for (const line of placement.urlLines) {
      const width = font.widthOfTextAtSize(line.text, line.size);
      expect(line.size).toBe(8);
      expect(inside({ x: line.x, y: line.y - 2, width, height: line.size + 2 }, band)).toBe(true);
      expect(line.x + width).toBeLessThanOrEqual(placement.qr.x);
    }
    expect(placement.urlLines.map((line) => line.text).join("")).toBe(url);

    expect(inside(placement.content, contentRegion)).toBe(true);
    expect(intersects(placement.content, band)).toBe(false);
    expect(placement.scale).toBeCloseTo(720 / 792, 5);
    expect(placement.content.height).toBeCloseTo(720, 3);
    expect(placement.content.y).toBeCloseTo(0, 3);
    expect(placement.content.width).toBeCloseTo((612 * 720) / 792, 3);
    expect(placement.content.x).toBeCloseTo((612 - placement.content.width) / 2, 3);
    expect(placement.content.width / source.width).toBeCloseTo(placement.content.height / source.height, 5);

    const stamped = await stampVerificationQr(cover, token);
    const saved = await PDFDocument.load(stamped, { updateMetadata: false });
    expect(saved.getCreator()).toBe(BRAND_NAME);
    expect(saved.getProducer()).toBe(BRAND_NAME);
    expect(saved.getProducer()).not.toContain("pdf-lib");
    expect(saved.getCreator()).not.toContain("pdf-lib");
    const page = saved.getPage(0);
    expect(page.getWidth()).toBe(612);
    expect(page.getHeight()).toBe(792);
    expect(page.getMediaBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    expect(page.getRotation().angle).toBe(0);
    const text = await pdfText(stamped);
    expect(text).toContain(url);
    expect(text).toContain(SIGN_ROLE_TRANSLATOR.replace(/\s+/g, ""));
    expect(text).toContain(BRAND_STREET.replace(/\s+/g, ""));
  });

  it("scales a non-letter page into the 612x720 area and leaves later pages unchanged", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([500, 500]);
    doc.addPage([200, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const url = verificationUrl("a".repeat(43));
    const placement = verificationStampPlacement(
      { width: 500, height: 500 },
      url,
      (text, size) => font.widthOfTextAtSize(text, size),
      qrMatrix(url).size,
    );
    const contentRegion: StampRect = { x: 0, y: 0, width: 612, height: 720 };
    expect(inside(placement.content, contentRegion)).toBe(true);
    expect(placement.content.width / 500).toBeCloseTo(placement.content.height / 500, 5);
    expect(placement.content.x).toBeCloseTo((612 - placement.content.width) / 2, 3);
    expect(inside(placement.qr, placement.band)).toBe(true);
    expect(inside(placement.label, placement.band)).toBe(true);

    const stamped = await stampVerificationQr(await doc.save(), "a".repeat(43));
    const saved = await PDFDocument.load(stamped);
    expect(saved.getPageCount()).toBe(2);
    expect(saved.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(saved.getPage(1).getSize()).toEqual({ width: 200, height: 400 });
  });
});

function intersects(a: StampRect, b: StampRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inside(inner: StampRect, outer: StampRect): boolean {
  return (
    inner.x >= outer.x - 0.01 &&
    inner.y >= outer.y - 0.01 &&
    inner.x + inner.width <= outer.x + outer.width + 0.01 &&
    inner.y + inner.height <= outer.y + outer.height + 0.01
  );
}

describe("final pdf hooks", () => {
  it("stamps a translation when the certified packet is stored", async () => {
    const db = memoryDb();
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    await storeCertifiedTranslation(db as unknown as Db, {
      orderId,
      version: 1,
      cleanTranslation: await blankPdf(),
      combinedOriginalPath: null,
    });
    const uploaded = vi.mocked(storage.uploadObject).mock.calls[0]?.[3];
    expect(uploaded).toBeInstanceOf(Uint8Array);
    const token = String(db.tables.verification_links?.[0]?.token);
    expect(db.tables.verification_links?.[0]?.document_type).toBe("translation");
    expect(await pdfText(uploaded as Uint8Array)).toContain(verificationUrl(token));
  });

  it("stamps a translation again when the approved cover is saved", async () => {
    const client = memoryDb();
    vi.spyOn(ordersDb, "listDocuments").mockResolvedValue([]);
    vi.spyOn(ordersDb, "listPages").mockResolvedValue([]);
    vi.spyOn(ordersDb, "listConfirmations").mockResolvedValue([]);
    vi.spyOn(ordersDb, "customerEmail").mockResolvedValue(null);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(await blankPdf());
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    await stampApprovedCover(
      client as unknown as Db,
      {
        id: orderId,
        service: null,
        sourceLanguage: "es",
        targetLanguage: "en",
        finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
        certificationPath: `${orderId}/certified-translation-v1.pdf`,
        combinedOriginalPath: null,
        billablePages: 1,
        degreeCount: null,
      } as OrderRecord,
      null,
    );
    const uploaded = vi.mocked(storage.uploadObject).mock.calls.at(-1)?.[3];
    const token = String(client.tables.verification_links?.[0]?.token);
    expect(await pdfText(uploaded as Uint8Array)).toContain(verificationUrl(token));
  });
});

describe("public verification", () => {
  const token = "verifytokenverifytokenverifytokenverifytok";
  const signedUrl = "https://files.example/final.pdf?sig=short-lived";

  function seeded() {
    return memoryDb({
      verification_links: [
        {
          token,
          order_id: orderId,
          document_type: "evaluation",
          created_at: "2026-10-23T19:10:00.000Z",
          revoked_at: null,
          revoked_by: null,
        },
      ],
      orders: [orderRow({ final_translation_path: `${orderId}/evaluation.pdf`, certification_path: `${orderId}/evaluation.pdf` })],
      deliveries: [{ order_id: orderId, final_path: `${orderId}/evaluation.pdf`, certification_path: `${orderId}/evaluation.pdf` }],
    });
  }

  it("returns the pdf url only while the link is valid, with no customer pii", async () => {
    const db = seeded();
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue(signedUrl);
    const valid = await readVerification(db as unknown as Db, token);
    expect(valid).toEqual({
      status: "valid",
      type: "evaluation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      documentUrl: signedUrl,
      reference: orderId,
    });
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(
      db,
      "finals",
      `${orderId}/evaluation.pdf`,
      DOWNLOAD_URL_SECONDS,
    );
    expect(vi.mocked(storage.signedObjectUrl).mock.calls[0]).toHaveLength(4);
    const body = JSON.stringify(valid);
    expect(body).not.toContain("ada@example.com");
    expect(body).not.toContain("1990-01-01");
    expect(body).not.toContain("1 Secret Street");
    expect(body).not.toContain(token);
    expect(db.selects.some((entry) => entry.includes("email") || entry.includes("date_of_birth") || entry.includes("shipping"))).toBe(
      false,
    );

    db.tables.verification_links![0]!.revoked_at = "2026-10-23T20:00:00.000Z";
    vi.mocked(storage.signedObjectUrl).mockClear();
    const revoked = await readVerification(db as unknown as Db, token);
    expect(revoked).toEqual({
      status: "revoked",
      type: "evaluation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      reference: orderId,
    });
    expect(revoked).not.toHaveProperty("documentUrl");
    expect(storage.signedObjectUrl).not.toHaveBeenCalled();
    expect(await readVerification(db as unknown as Db, `${token}x`)).toEqual({ status: "not_found" });
  });

  it("rate limits an address", async () => {
    vi.spyOn(storage, "serviceDb").mockReturnValue(memoryDb() as unknown as Db);
    const request = new Request("https://www.credpronto.com/api/verify/nope", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    for (let i = 0; i < VERIFY_RATE_MAX; i += 1) {
      expect(await publicVerification(request, "not-a-token")).toEqual({ status: "not_found" });
    }
    await expect(publicVerification(request, "not-a-token")).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });
});

describe("staff revoke", () => {
  const token = "verifytokenverifytokenverifytokenverifytok";

  it("requires staff and does not return the token", async () => {
    vi.spyOn(staff, "requireStaff").mockRejectedValue(new HttpError("Staff access required", 403));
    await expect(setVerificationRevoked(orderId, { type: "evaluation", revoked: true })).rejects.toMatchObject({
      status: 403,
    });

    const db = memoryDb({
      orders: [orderRow()],
      verification_links: [
        {
          token,
          order_id: orderId,
          document_type: "translation",
          created_at: "2026-10-23T19:10:00.000Z",
          revoked_at: null,
          revoked_by: null,
        },
      ],
    });
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: db as unknown as Db, userId: "staff-1", role: "admin" });
    const revoked = await setVerificationRevoked(orderId, { type: "translation", revoked: true });
    expect(revoked).toEqual({
      status: "revoked",
      type: "translation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      reference: orderId,
    });
    expect(revoked).not.toHaveProperty("token");
    expect(JSON.stringify(revoked)).not.toContain(token);
    expect(db.tables.verification_links?.[0]).toMatchObject({ revoked_by: "staff-1" });

    const restored = await setVerificationRevoked(orderId, { type: "translation", revoked: false });
    expect(restored.status).toBe("valid");
    expect(db.tables.verification_links?.[0]?.revoked_at).toBeNull();
  });

  it("rejects a non-staff request on the admin route", async () => {
    vi.spyOn(staff, "requireStaff").mockRejectedValue(new HttpError("Staff access required", 403));
    const response = await revokeVerification(
      new Request("https://www.credpronto.com/api/admin/orders/1/verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "evaluation", revoked: true }),
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "Staff access required" });
  });
});

describe("GET /api/verify/[token]", () => {
  it("returns the document url uncached", async () => {
    const token = generateVerificationToken();
    const db = memoryDb({
      verification_links: [
        {
          token,
          order_id: orderId,
          document_type: "translation",
          created_at: "2026-10-23T19:10:00.000Z",
          revoked_at: null,
        },
      ],
      orders: [orderRow()],
      deliveries: [],
    });
    vi.spyOn(storage, "serviceDb").mockReturnValue(db as unknown as Db);
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://files.example/final.pdf?sig=short-lived");
    const response = await readVerifyRoute(
      new Request(`https://www.credpronto.com/api/verify/${token}`, {
        headers: { "x-forwarded-for": "203.0.113.20" },
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "valid",
      type: "translation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      documentUrl: "https://files.example/final.pdf?sig=short-lived",
      reference: orderId,
    });
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
