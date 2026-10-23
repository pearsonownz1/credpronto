import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as revokeVerification } from "@/app/api/admin/orders/[id]/verification/route";
import { GET as readVerifyRoute } from "@/app/api/verify/[token]/route";
import { DOWNLOAD_URL_SECONDS } from "./constants";
import * as ordersDb from "./db";
import { HttpError } from "./errors";
import { stampApprovedCover } from "./certification";
import { storeCertifiedTranslation } from "./final-file";
import { qrMatrix, verificationUrl } from "./pdf/verify-stamp";
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
});

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
