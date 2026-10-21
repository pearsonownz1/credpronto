import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchTranslation,
  internalOrigin,
  TRANSLATION_ASSEMBLE_PATH,
  TRANSLATION_PAGE_PATH,
  withTranslationDispatch,
} from "./translation-dispatch";
import {
  TRANSLATION_PAGE_CONCURRENCY,
  dispatchConcurrency,
  isSkippedTranslationPage,
  jobsToDispatch,
  pageAttemptResult,
  pageTranslationPhrases,
  pagesToTranslate,
  simulateBillableTranslation,
  translationPagePlan,
  type SimPage,
} from "./translation-pages";

describe("billable page translation", () => {
  it("translates a 9-page document one page at a time and leaves English, blank, and label pages out", () => {
    const pages: SimPage[] = [
      ...Array.from({ length: 9 }, (_, index) => ({ id: `page-${index + 1}` })),
      { id: "english", skip: true, skipReason: "english" },
      { id: "blank", skip: true, skipReason: "blank" },
      { id: "label", skip: true, skipReason: "label" },
    ];
    const run = simulateBillableTranslation({
      pages,
      ocr: { pagesRead: 12, pagesTotal: 12 },
      outcomes: { "page-1": ["fail", "ok"] },
    });

    expect(pagesToTranslate(pages)).toHaveLength(9);
    expect(run.pagesTranslateTotal).toBe(9);
    expect(run.assembled).toBe(true);
    expect(run.failure).toBeNull();
    expect(run.maxInFlight).toBe(TRANSLATION_PAGE_CONCURRENCY);
    expect(run.maxInFlight).toBeLessThanOrEqual(3);
    expect(new Set(run.invocations.map((call) => call.pageId))).toEqual(
      new Set(Array.from({ length: 9 }, (_, index) => `page-${index + 1}`)),
    );
    expect(run.invocations.filter((call) => call.pageId === "page-1")).toEqual([
      { pageId: "page-1", attempt: 1 },
      { pageId: "page-1", attempt: 2 },
    ]);
    expect(run.invocations).toHaveLength(10);
    expect(run.invocations.some((call) => call.pageId === "english" || call.pageId === "blank" || call.pageId === "label")).toBe(
      false,
    );

    const translating = run.progress.filter((row) => row.step === "translating");
    expect(translating.map((row) => row.pagesDone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(translating.every((row) => row.pagesRead === 12 && row.pagesTotal === 12 && row.pagesTranslateTotal === 9)).toBe(
      true,
    );
    expect(run.progress.at(-1)).toEqual({
      step: "done",
      pagesRead: 12,
      pagesTotal: 12,
      pagesDone: 9,
      pagesTranslateTotal: 9,
    });
  });

  it("stops after a page fails twice and does not assemble", () => {
    const run = simulateBillableTranslation({
      pages: [{ id: "only" }, { id: "next" }],
      ocr: { pagesRead: 2, pagesTotal: 2 },
      concurrency: 1,
      outcomes: { only: ["fail", "fail"] },
    });
    expect(run.invocations).toEqual([
      { pageId: "only", attempt: 1 },
      { pageId: "only", attempt: 2 },
    ]);
    expect(run.failure).toEqual({ pageId: "only", attempts: 2 });
    expect(run.assembled).toBe(false);
    expect(run.progress.at(-1)?.step).toBe("done");
    expect(pageAttemptResult(1, false)).toBe("retry");
    expect(pageAttemptResult(2, false)).toBe("fail");
    expect(pageAttemptResult(2, true)).toBe("ready");
  });

  it("treats english, blank, and label reasons as not translated", () => {
    expect(isSkippedTranslationPage({ skip: true, skipReason: "already English" })).toBe(true);
    expect(isSkippedTranslationPage({ skipReason: "blank" })).toBe(true);
    expect(isSkippedTranslationPage({ skipReason: "shipping_label" })).toBe(true);
    expect(isSkippedTranslationPage({ skip: false, skipReason: null })).toBe(false);
    expect(jobsToDispatch(
      [
        { id: "a", status: "running" },
        { id: "b", status: "pending" },
        { id: "c", status: "pending" },
        { id: "d", status: "pending" },
      ],
      3,
    ).map((job) => job.id)).toEqual(["b", "c"]);
  });

  it("widens orders_progress_chk for pagesDone and pagesTranslateTotal", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261012150000_translation_page_progress.sql"),
      "utf8",
    );
    expect(sql).toMatch(/orders_progress_chk/);
    expect(sql).toMatch(/pagesDone/);
    expect(sql).toMatch(/pagesTranslateTotal/);
    expect(sql).toMatch(/\(progress->>'pagesDone'\)::integer <= \(progress->>'pagesTranslateTotal'\)::integer/);
    expect(sql).toMatch(/create table public\.translation_page_jobs/);
    expect(sql).toMatch(/create table public\.translation_runs/);
    expect(sql.toLowerCase()).not.toMatch(/alter table public\.orders\s+add column/);
    const pageRoute = readFileSync(
      path.join(process.cwd(), "src/app/api/internal/translation/page/route.ts"),
      "utf8",
    );
    const assembleRoute = readFileSync(
      path.join(process.cwd(), "src/app/api/internal/translation/assemble/route.ts"),
      "utf8",
    );
    expect(pageRoute).toMatch(/maxDuration = 300/);
    expect(pageRoute).toMatch(/after\(/);
    expect(pageRoute).toMatch(/withTranslationDispatch/);
    expect(assembleRoute).toMatch(/runTranslationAssemble/);
    expect(assembleRoute).toMatch(/withTranslationDispatch/);
    expect(pageRoute).toMatch(/internalTranslationAuthorized/);
    const jobsSource = readFileSync(path.join(process.cwd(), "src/lib/orders/translation-jobs.ts"), "utf8");
    expect(jobsSource).not.toMatch(/\bfetch\(/);
  });
});

describe("translation dispatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.APP_URL;
    delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  });

  it("posts the page job to this deployment with the cron bearer", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.VERCEL_URL = "preview.example.vercel.app";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await dispatchTranslation(TRANSLATION_PAGE_PATH, { orderId: "order-1", version: 2, jobId: "job-1" });
    expect(internalOrigin()).toBe("https://preview.example.vercel.app");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://preview.example.vercel.app/api/internal/translation/page",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
        body: JSON.stringify({ orderId: "order-1", version: 2, jobId: "job-1" }),
      }),
    );
  });

  it("continues a page, retry, or assemble in-process instead of fetching this deployment again", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.VERCEL_URL = "preview.example.vercel.app";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const inline = vi.fn(async () => {});
    const first = { orderId: "order-1", version: 1, jobId: "job-1" };
    const continuations = [2, 3, 4, 5].map((job) => ({
      orderId: "order-1",
      version: 1,
      jobId: `job-${job}`,
    }));

    await dispatchTranslation(TRANSLATION_PAGE_PATH, first, inline);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inline).not.toHaveBeenCalled();

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => new Response("Infinite loop detected", { status: 508 }));
    await withTranslationDispatch(async () => {
      for (const body of continuations) {
        await dispatchTranslation(TRANSLATION_PAGE_PATH, body, inline);
      }
      await dispatchTranslation(TRANSLATION_ASSEMBLE_PATH, { orderId: "order-1", version: 1 }, inline);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(inline).toHaveBeenCalledTimes(5);

    fetchMock.mockClear();
    inline.mockClear();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 202 }));
    await withTranslationDispatch(async () => {
      await dispatchTranslation(
        TRANSLATION_PAGE_PATH,
        { orderId: "order-1", version: 2, jobId: "job-next" },
        inline,
        { fresh: true },
      );
    });
    expect(inline).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://preview.example.vercel.app/api/internal/translation/page",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ orderId: "order-1", version: 2, jobId: "job-next" }),
      }),
    );
    const pending = [
      { id: "running-a", status: "running" as const },
      { id: "running-b", status: "running" as const },
      { id: "next-a", status: "pending" as const },
      { id: "next-b", status: "pending" as const },
      { id: "next-c", status: "pending" as const },
    ];
    expect(jobsToDispatch(pending, dispatchConcurrency(2, true)).map((job) => job.id)).toEqual(["next-a"]);
    const full = [
      { id: "running-a", status: "running" as const },
      { id: "running-b", status: "running" as const },
      { id: "running-c", status: "running" as const },
      { id: "next-a", status: "pending" as const },
    ];
    expect(jobsToDispatch(full, dispatchConcurrency(3, true))).toEqual([]);
    const open = [
      { id: "next-a", status: "pending" as const },
      { id: "next-b", status: "pending" as const },
      { id: "next-c", status: "pending" as const },
      { id: "next-d", status: "pending" as const },
    ];
    expect(jobsToDispatch(open, dispatchConcurrency(0, false)).map((job) => job.id)).toEqual([
      "next-a",
      "next-b",
      "next-c",
    ]);
    expect(jobsToDispatch(open, dispatchConcurrency(0, true)).map((job) => job.id)).toEqual(["next-a"]);
  });

  it("returns the public app origin when VERCEL_ENV is production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "credpronto-prod.vercel.app";
    process.env.APP_URL = "https://credpronto.com";
    expect(internalOrigin()).toBe("https://credpronto.com");
  });
});

describe("translation page plan", () => {
  const pages = [
    { id: "keep" },
    { id: "change" },
    { id: "failed" },
    { id: "new" },
    { id: "skip", skip: true, skipReason: "english" },
  ];

  it("reuses a matching page, restarts a language or failure, and starts a missing page", () => {
    const plan = translationPagePlan({
      pages,
      sourceLanguage: "es",
      targetLanguage: "en",
      jobs: [
        { pageId: "keep", status: "ready", sourceLanguage: "es", targetLanguage: "en" },
        { pageId: "change", status: "running", sourceLanguage: "es", targetLanguage: "fr" },
        { pageId: "failed", status: "failed", sourceLanguage: "es", targetLanguage: "en" },
        { pageId: "skip", status: "pending", sourceLanguage: "es", targetLanguage: "en" },
      ],
    });
    expect(plan).toEqual({ reuse: ["keep"], rerun: ["change", "failed"], start: ["new"] });
  });

  it("restarts when the confirmed source language differs and reuses a job with no snapshot", () => {
    const plan = translationPagePlan({
      pages: [{ id: "source" }, { id: "legacy" }],
      sourceLanguage: "fr",
      targetLanguage: "en",
      jobs: [
        { pageId: "source", status: "ready", sourceLanguage: "es", targetLanguage: "en" },
        { pageId: "legacy", status: "running", sourceLanguage: null, targetLanguage: null },
      ],
    });
    expect(plan).toEqual({ reuse: ["legacy"], rerun: ["source"], start: [] });
  });

  it("keeps the English prompt and names another target", () => {
    expect(pageTranslationPhrases("en")).toEqual({
      lead: "Translate this document into English, one original page to one translated page.",
      labels: "Translate labels into English.",
    });
    expect(pageTranslationPhrases("es").lead).toBe(
      "Translate this document into Spanish, one original page to one translated page.",
    );
    expect(pageTranslationPhrases("es").labels).toBe("Translate labels into Spanish.");
  });
});
