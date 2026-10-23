import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES } from "./constants";
import {
  assertDirectFile,
  assertSessionPath,
  issueUploadSession,
  parseDirectOrder,
  readDirectOrder,
  referencedOriginals,
  storeReferencedFiles,
  ticketFiles,
} from "./direct-upload";
import { HttpError } from "./errors";
import type { Db } from "./storage";

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";

function fileId(index: number): string {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function objectPath(index: number, filename = "notes.pdf"): string {
  return `${SESSION}/${fileId(index)}/${filename}`;
}

function storageDb(objects: Record<string, { size?: number | null; bytes?: Uint8Array; missing?: boolean }>): Db {
  const downloads: string[] = [];
  const db = {
    downloads,
    storage: {
      from() {
        return {
          async info(objectPath: string) {
            const object = objects[objectPath];
            if (!object || object.missing) return { data: null, error: { message: "Object not found" } };
            return { data: { size: object.size ?? object.bytes?.byteLength ?? 0, contentType: "application/pdf" }, error: null };
          },
          async download(objectPath: string) {
            downloads.push(objectPath);
            const object = objects[objectPath];
            if (!object?.bytes) return { data: null, error: { message: "Object not found" } };
            const copy = Uint8Array.from(object.bytes);
            return { data: new Blob([copy.buffer]), error: null };
          },
          async createSignedUploadUrl(objectPath: string) {
            return {
              data: { signedUrl: `https://files.example/upload/${objectPath}?token=tok`, token: "tok", path: objectPath },
              error: null,
            };
          },
        };
      },
    },
  };
  return db as unknown as Db;
}

describe("direct upload limits", () => {
  it("allows 50MB and does not cap the file count", () => {
    expect(assertDirectFile({ name: "scan.pdf", size: MAX_DIRECT_FILE_BYTES, type: "application/pdf" })).toMatchObject({
      filename: "scan.pdf",
      mime: "application/pdf",
      size: MAX_DIRECT_FILE_BYTES,
    });
    expect(() => assertDirectFile({ name: "scan.pdf", size: MAX_DIRECT_FILE_BYTES + 1, type: "application/pdf" })).toThrow(
      DIRECT_FILE_LIMIT_MESSAGE,
    );
    const files = Array.from({ length: 16 }, (_, index) => ({
      name: `page-${index}.jpg`,
      size: 100 + index,
      type: "image/jpeg",
    }));
    expect(ticketFiles({ files })).toHaveLength(16);
  });
});

describe("upload session paths", () => {
  it("signs keys under the session id", async () => {
    const session = await issueUploadSession(storageDb({}), [
      { name: "diploma.pdf", size: 20, type: "application/pdf" },
      { name: "photo.png", size: 30, type: "image/png" },
    ]);
    expect(session.uploads).toHaveLength(2);
    for (const upload of session.uploads) {
      expect(upload.path.startsWith(`${session.sessionId}/`)).toBe(true);
      expect(assertSessionPath(session.sessionId, upload.path).filename.length).toBeGreaterThan(0);
      expect(() => assertSessionPath(OTHER, upload.path)).toThrow(/outside this upload/);
    }
  });

  it("rejects a key outside the session prefix", () => {
    expect(() => assertSessionPath(SESSION, objectPath(1))).not.toThrow();
    expect(() => assertSessionPath(SESSION, `${OTHER}/${fileId(1)}/notes.pdf`)).toThrow(HttpError);
    expect(() => assertSessionPath(SESSION, `${SESSION}/../${OTHER}/notes.pdf`)).toThrow(/outside this upload/);
    expect(() => assertSessionPath(SESSION, `${SESSION}/${fileId(1)}/../../secret.pdf`)).toThrow(/outside this upload/);
    expect(() => parseDirectOrder({
      sessionId: SESSION,
      files: [{ path: `${OTHER}/${fileId(1)}/notes.pdf`, filename: "notes.pdf", mime: "application/pdf", size: 10 }],
    })).toThrow(/outside this upload/);
  });
});

describe("referenced originals", () => {
  it("keeps a distinct file of any count and drops a later copy of the same bytes", async () => {
    const same = new Uint8Array([1, 2, 3, 4]);
    const other = new Uint8Array([1, 2, 3, 5]);
    const objects: Record<string, { size: number; bytes: Uint8Array }> = {
      [objectPath(1, "a.pdf")]: { size: 4, bytes: same },
      [objectPath(2, "b.pdf")]: { size: 4, bytes: same },
      [objectPath(3, "c.pdf")]: { size: 4, bytes: other },
    };
    for (let index = 4; index <= 16; index += 1) {
      objects[objectPath(index, `p${index}.pdf`)] = { size: 100 + index, bytes: new Uint8Array([index]) };
    }
    const db = storageDb(objects);
    const files = Object.keys(objects).map((objectPath) => ({
      path: objectPath,
      filename: objectPath.split("/").at(-1) ?? "notes.pdf",
      mime: "application/pdf",
      size: objects[objectPath]?.size ?? 0,
    }));
    const stored = await referencedOriginals(db, SESSION, files);
    expect(stored.map((file) => file.filename)).toEqual([
      "a.pdf",
      "c.pdf",
      ...Array.from({ length: 13 }, (_, index) => `p${index + 4}.pdf`),
    ]);
    expect(stored[0]).toMatchObject({
      id: fileId(1),
      path: objectPath(1, "a.pdf"),
      mime: "application/pdf",
      size: 4,
    });
    expect((db as unknown as { downloads: string[] }).downloads).toEqual([
      objectPath(1, "a.pdf"),
      objectPath(2, "b.pdf"),
      objectPath(3, "c.pdf"),
    ]);
  });

  it("returns the storage error when the object is missing", async () => {
    const db = storageDb({ [objectPath(1)]: { missing: true } });
    await expect(
      referencedOriginals(db, SESSION, [
        { path: objectPath(1), filename: "notes.pdf", mime: "application/pdf", size: 4 },
      ]),
    ).rejects.toThrow("Object not found");
  });
});

describe("document rows", () => {
  it("inserts the same documents columns the pipeline reads and does not upload bytes", async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const db = {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push({ table, ...row });
            return { error: null };
          },
        };
      },
      storage: {
        from() {
          throw new Error("bytes should already be in storage");
        },
      },
    };
    await storeReferencedFiles(db as unknown as Db, SESSION, [
      {
        id: fileId(1),
        path: objectPath(1, "diploma.pdf"),
        filename: "diploma.pdf",
        mime: "application/pdf",
        size: 42,
      },
    ]);
    expect(inserts).toEqual([
      {
        table: "documents",
        id: fileId(1),
        order_id: SESSION,
        original_path: objectPath(1, "diploma.pdf"),
        filename: "diploma.pdf",
        mime: "application/pdf",
        size: 42,
        position: 1,
        status: "uploaded",
      },
    ]);
  });
});

describe("direct order body", () => {
  it("accepts a guest quote with no email", () => {
    const parsed = parseDirectOrder({
      sessionId: SESSION,
      files: [{ path: objectPath(1), filename: "notes.pdf", mime: "application/pdf", size: 10 }],
    });
    expect(parsed.email).toBeNull();
  });

  it("rejects a multipart body", async () => {
    const request = new Request("https://credpronto.test/api/orders", { method: "POST", body: "email=a" });
    await expect(readDirectOrder(request)).rejects.toThrow("Expected a JSON body");
  });
});

describe("originals bucket limit", () => {
  it("pins the originals bucket at 50MB", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261013140100_originals_file_size_limit.sql"),
      "utf8",
    );
    expect(sql).toMatch(/update storage\.buckets/);
    expect(sql).toMatch(/id = 'originals'/);
    expect(sql).toMatch(/file_size_limit = 52428800/);
    expect(sql).toMatch(/file_size_limit is null or file_size_limit < 52428800/);
  });
});

describe("signed upload failures", () => {
  it("surfaces the storage error from createSignedUploadUrl", async () => {
    const db = {
      storage: {
        from() {
          return {
            async createSignedUploadUrl() {
              return { data: null, error: { message: "The object exceeded the maximum allowed size" } };
            },
          };
        },
      },
    };
    await expect(
      issueUploadSession(db as unknown as Db, [{ name: "scan.pdf", size: 10, type: "application/pdf" }]),
    ).rejects.toThrow("The object exceeded the maximum allowed size");
  });
});
