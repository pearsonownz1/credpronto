import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIPLOMA_UNIT_CENTS, COURSE_BY_COURSE_UNIT_CENTS } from "@/lib/orders/evaluation-price";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { HttpError } from "@/lib/orders/errors";
import { EVALUATION_TURNAROUND_COPY, TRANSLATION_TURNAROUND_COPY } from "@/lib/flow/present";
import { hashApiKey } from "@/lib/orders/api-key";
import { isMcpHold } from "@/lib/orders/mcp-hold";
import { billingChargePlan, billingRequiredError, chargeAccount, publicCharge } from "./billing";
import { getQuote, listServices } from "./catalog";
import { decodeBase64File, isBlockedAddress, isBlockedHostname, sha256Hex } from "./files";
import { bearerMcpApiKey, generateMcpApiKey, partitionApiKeys } from "./keys";
import { assertMcpOrder, rejectIdentityFields } from "./scope";
import { customerStage, matchesStatusFilter } from "./status";
import { MCP_TOOL_DOCS } from "./docs";
import { handleMcpRequest } from "./server";
import { configFor } from "./quickstart";
import * as actions from "./actions";
import * as integrationsDb from "@/lib/orders/integrations-db";
import * as storage from "@/lib/orders/storage";
import * as ordersDb from "@/lib/orders/db";
import * as customer from "@/lib/orders/customer";
import * as partner from "@/lib/orders/partner";
import * as previewRead from "@/lib/orders/preview-read";
import * as verification from "@/lib/orders/verification";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP keys", () => {
  it("shows a cpk_live_ secret once and stores only its sha256", () => {
    const key = generateMcpApiKey();
    expect(key.secret.startsWith("cpk_live_")).toBe(true);
    expect(key.secret.slice("cpk_live_".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(key.hash).toBe(hashApiKey(key.secret));
    expect(key.secret).not.toBe(key.hash);
    expect(key.last4).toBe(key.secret.slice(-4));
  });

  it("accepts only MCP bearer keys", () => {
    const { secret } = generateMcpApiKey();
    expect(bearerMcpApiKey(`Bearer ${secret}`)).toBe(secret);
    expect(bearerMcpApiKey("Bearer cp_live_" + "a".repeat(64))).toBeNull();
    expect(bearerMcpApiKey("Bearer cp_test_" + "ab".repeat(32))).toBeNull();
    expect(bearerMcpApiKey(null)).toBeNull();
  });

  it("keeps partner keys and MCP keys apart", () => {
    const split = partitionApiKeys([
      { prefix: "cp_live_" },
      { prefix: "cp_test_" },
      { prefix: "cpk_live_" },
    ]);
    expect(split.partner.map((key) => key.prefix)).toEqual(["cp_live_", "cp_test_"]);
    expect(split.mcp).toEqual([{ prefix: "cpk_live_" }]);
  });
});

describe("MCP scoping", () => {
  it("rejects another customer's order and the file hold", () => {
    expect(assertMcpOrder({ userId: "user-1", externalRef: null }, "user-1").userId).toBe("user-1");
    expect(() => assertMcpOrder({ userId: "user-2", externalRef: null }, "user-1")).toThrow(HttpError);
    expect(() => assertMcpOrder({ userId: "user-1", externalRef: "mcp-hold" }, "user-1")).toThrow(HttpError);
    expect(() => assertMcpOrder(null, "user-1")).toThrow(HttpError);
    try {
      assertMcpOrder({ userId: "user-2", externalRef: "crm" }, "user-1");
    } catch (error) {
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }
  });

  it("refuses SSN and date of birth fields", () => {
    expect(() => rejectIdentityFields({ notes: "fix the name" })).not.toThrow();
    expect(() => rejectIdentityFields({ ssn: "123" })).toThrow(HttpError);
    expect(() => rejectIdentityFields({ date_of_birth: "1990-01-01" })).toThrow(HttpError);
    expect(() => rejectIdentityFields({ nested: { birthDate: "1990-01-01" } })).toThrow(HttpError);
  });

  it("does not list the staging hold as an order", () => {
    expect(isMcpHold("mcp-hold")).toBe(true);
    expect(isMcpHold(null)).toBe(false);
    expect(isMcpHold("crm-1")).toBe(false);
  });
});

describe("MCP catalog and quote", () => {
  it("lists translation, both evaluations, languages, and standard turnaround", () => {
    const catalog = listServices();
    expect(catalog.services.map((item) => item.id)).toEqual(["translation", "diploma", "course_by_course"]);
    expect(catalog.services[0]?.unitCents).toBe(UNIT_PRICE_CENTS);
    expect(catalog.services[1]?.unitCents).toBe(DIPLOMA_UNIT_CENTS);
    expect(catalog.services[2]?.unitCents).toBe(COURSE_BY_COURSE_UNIT_CENTS);
    expect(catalog.languages.source.some((item) => item.code === "es")).toBe(true);
    expect(catalog.turnaround).toHaveLength(1);
    expect(catalog.rushOffered).toBe(false);
    expect(catalog.services.some((item) => item.name === "demo")).toBe(false);
  });

  it("prices a translation and both evaluation types from the existing rates", () => {
    expect(getQuote({ service: "translation", pageCount: 3, sourceLanguage: "es", targetLanguage: "en" })).toMatchObject({
      amountCents: 3 * UNIT_PRICE_CENTS,
      turnaround: TRANSLATION_TURNAROUND_COPY,
      rushOffered: false,
    });
    expect(getQuote({ service: "evaluation", evaluationType: "diploma", degreeCount: 2 })).toMatchObject({
      amountCents: 2 * DIPLOMA_UNIT_CENTS,
      turnaround: EVALUATION_TURNAROUND_COPY,
    });
    expect(
      getQuote({
        service: "evaluation",
        evaluationType: "course_by_course",
        degreeCount: 1,
        includeTranslation: true,
        pageCount: 2,
        sourceLanguage: "pt",
      }).amountCents,
    ).toBe(COURSE_BY_COURSE_UNIT_CENTS + 2 * UNIT_PRICE_CENTS);
  });

  it("rejects rush, unsupported languages, and identity fields", () => {
    expect(() => getQuote({ service: "translation", pageCount: 1, sourceLanguage: "es", rush: true })).toThrow(
      /Expedited/,
    );
    expect(() => getQuote({ service: "translation", pageCount: 1, sourceLanguage: "en" })).toThrow(/not supported/);
    expect(() => getQuote({ service: "translation", pageCount: 1, sourceLanguage: "es", ssn: "1" })).toThrow(
      /not accepted/,
    );
  });
});

describe("MCP order stages", () => {
  it("uses the dashboard stages and filters by them", () => {
    expect(customerStage({ status: "processing", serviceType: "translation", etaAt: "2026-11-01T00:00:00.000Z" })).toMatchObject({
      stage: "translating",
      etaAt: "2026-11-01T00:00:00.000Z",
    });
    expect(customerStage({ status: "preview_ready", serviceType: "translation" }).stage).toBe("preview_ready");
    expect(customerStage({ status: "quoted", serviceType: "translation" }).stage).toBe("needs_check");
    expect(customerStage({ status: "paid", serviceType: "translation" }).stageLabel).toBe("Paid and in staff review");
    expect(customerStage({ status: "delivered", serviceType: "translation", downloadAvailable: true }).stage).toBe("ready");
    const order = { status: "preview_ready", serviceType: "translation" };
    expect(matchesStatusFilter(order, "preview_ready")).toBe(true);
    expect(matchesStatusFilter(order, "translating")).toBe(false);
    expect(matchesStatusFilter(order, null)).toBe(true);
  });
});

describe("MCP billing", () => {
  const card = { terms: "card" as const, customerId: "cus_1", paymentMethodId: "pm_1", openInvoiceId: null };
  const net = { terms: "net" as const, customerId: "cus_1", paymentMethodId: null, openInvoiceId: "in_1" };

  it("charges a saved card or adds to the invoice, and links to billing when neither is set up", () => {
    expect(billingChargePlan({ account: card, stripeKey: "sk_live_123" }).action).toBe("card");
    expect(billingChargePlan({ account: net, stripeKey: "sk_test_123" }).action).toBe("invoice");
    expect(billingChargePlan({ account: { ...card, paymentMethodId: null }, stripeKey: "sk_live_123" })).toMatchObject({
      action: "refuse",
      code: "billing_required",
    });
    const unconfigured = billingChargePlan({ account: card, stripeKey: null });
    expect(unconfigured.action).toBe("refuse");
    if (unconfigured.action === "refuse") expect(unconfigured.code).toBe("payments_not_configured");
    expect(billingRequiredError("https://credpronto.com")).toMatchObject({
      status: 402,
      code: "billing_required",
      details: { billingUrl: "https://credpronto.com/dashboard/billing" },
    });
  });

  it("returns the charged amount and receipt or invoice id, never a checkout url", async () => {
    const cardReceipt = await chargeAccount({
      db: {} as never,
      userId: "user-1",
      orderId: "order-1",
      amountCents: 2985,
      currency: "usd",
      account: card,
      stripeKey: "sk_test_123",
      card: { charge: async () => ({ paymentIntentId: "pi_1", receiptId: "ch_1" }) },
      invoice: { add: async () => ({ invoiceId: "in_unused" }) },
    });
    const body = publicCharge(cardReceipt, "order-1", "paid");
    expect(body).toMatchObject({ amountCents: 2985, receiptId: "ch_1", invoiceId: null, payment: "card" });
    expect(body).not.toHaveProperty("checkoutUrl");

    const invoiceReceipt = await chargeAccount({
      db: {} as never,
      userId: "user-1",
      orderId: "order-2",
      amountCents: 1995,
      currency: "usd",
      account: net,
      stripeKey: "sk_live_123",
      card: { charge: async () => ({ paymentIntentId: "pi_unused", receiptId: "ch_unused" }) },
      invoice: { add: async () => ({ invoiceId: "in_9" }) },
    });
    expect(publicCharge(invoiceReceipt, "order-2", "needs_review")).toMatchObject({
      amountCents: 1995,
      invoiceId: "in_9",
      payment: "invoice",
      receiptId: null,
    });
    await expect(
      chargeAccount({
        db: {} as never,
        userId: "user-1",
        orderId: "order-3",
        amountCents: 995,
        currency: "usd",
        account: null,
        stripeKey: "sk_test_123",
        card: { charge: async () => ({ paymentIntentId: "pi", receiptId: "ch" }) },
        invoice: { add: async () => ({ invoiceId: "in" }) },
      }),
    ).rejects.toMatchObject({ code: "billing_required" });
  });
});

describe("MCP file intake", () => {
  it("hashes base64 bytes and blocks private URLs", () => {
    const bytes = decodeBase64File(Buffer.from("diploma").toString("base64"));
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.1.1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("files.example.com")).toBe(false);
  });
});

describe("MCP endpoint", () => {
  it("lists every tool and quotes through the streamable HTTP handler", async () => {
    const listed = await handleMcpRequest(rpc("tools/list"), { userId: "user-1", keyId: "key-1" });
    const listBody = await listed.json();
    const names = listBody.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(MCP_TOOL_DOCS.map((tool) => tool.name));
    expect(names).not.toContain("edit_pdf");
    expect(JSON.stringify(listBody).toLowerCase()).not.toContain("sharepoint");

    const quoted = await handleMcpRequest(
      rpc("tools/call", { name: "get_quote", arguments: { service: "translation", pageCount: 1, sourceLanguage: "es" } }),
      { userId: "user-1", keyId: "key-1" },
    );
    const quoteBody = await quoted.json();
    expect(quoteBody.result.isError).toBeUndefined();
    expect(JSON.parse(quoteBody.result.content[0].text).amountCents).toBe(UNIT_PRICE_CENTS);
  });

  it("initializes as credpronto", async () => {
    const response = await handleMcpRequest(
      rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
      { userId: "user-1", keyId: "key-1" },
    );
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe("credpronto");
    expect(body.result.capabilities.tools).toBeTruthy();
  });
});

describe("MCP auth", () => {
  it("rejects a missing key, a partner key, and a revoked key", async () => {
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as never);
    const find = vi.spyOn(integrationsDb, "findActiveApiKey").mockResolvedValue(null);
    await expect(actions.requireMcpKey(new Request("https://credpronto.com/api/mcp"))).rejects.toMatchObject({
      status: 401,
      code: "invalid_api_key",
    });
    const partner = `Bearer cp_live_${"ab".repeat(32)}`;
    await expect(
      actions.requireMcpKey(new Request("https://credpronto.com/api/mcp", { headers: { authorization: partner } })),
    ).rejects.toMatchObject({ status: 401 });
    expect(find).not.toHaveBeenCalled();

    const mcp = generateMcpApiKey();
    find.mockResolvedValue(null);
    await expect(
      actions.requireMcpKey(new Request("https://credpronto.com/api/mcp", { headers: { authorization: `Bearer ${mcp.secret}` } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("scopes a valid key to its customer and records last used", async () => {
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as never);
    vi.spyOn(integrationsDb, "findActiveApiKey").mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      name: "MCP",
      prefix: "cpk_live_",
      last4: "abcd",
      createdAt: "2026-10-31T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    });
    const touch = vi.spyOn(integrationsDb, "touchApiKeyLastUsed").mockResolvedValue();
    const key = generateMcpApiKey();
    const row = await actions.requireMcpKey(
      new Request("https://credpronto.com/api/mcp", { headers: { authorization: `Bearer ${key.secret}` } }),
    );
    expect(row.userId).toBe("user-1");
    expect(touch).toHaveBeenCalledWith(expect.anything(), "key-1");
    expect(integrationsDb.findActiveApiKey).toHaveBeenCalledWith(expect.anything(), hashApiKey(key.secret));
  });
});

describe("each MCP tool scopes to the key's customer", () => {
  const other = {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "user-2",
    externalRef: null,
    status: "preview_ready",
    serviceType: "translation",
    orderType: "translation",
    service: null,
    includeTranslation: false,
    etaAt: null,
    totalCents: 995,
    currency: "usd",
    billablePages: 1,
  };

  it("hides another customer's order from status, preview, approval, changes, download, and verify", async () => {
    vi.spyOn(storage, "serviceDb").mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as never);
    vi.spyOn(ordersDb, "getOrderById").mockResolvedValue(other as never);
    const ctx = { userId: "user-1", keyId: "key-1" };
    const args = { orderId: other.id };
    await expect(actions.getMcpOrderStatus(ctx, args)).rejects.toMatchObject({ status: 404 });
    await expect(actions.getMcpPreview(ctx, args)).rejects.toMatchObject({ status: 404 });
    await expect(actions.approveMcpPreview(ctx, args)).rejects.toMatchObject({ status: 404 });
    await expect(actions.requestMcpChanges(ctx, { ...args, notes: "The name is wrong" })).rejects.toMatchObject({ status: 404 });
    await expect(actions.downloadMcpCertified(ctx, args)).rejects.toMatchObject({ status: 404 });
    await expect(actions.verifyMcpCertificate(ctx, args)).rejects.toMatchObject({ status: 404 });
    expect(ordersDb.getOrderById).toHaveBeenCalled();
  });

  it("approve_preview records acceptance and does not edit the certified file", async () => {
    const order = { ...other, userId: "user-1" };
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as never);
    vi.spyOn(ordersDb, "getOrderById").mockResolvedValue(order as never);
    vi.spyOn(ordersDb, "latestReadyPreview").mockResolvedValue({ version: 2 } as never);
    const update = vi.spyOn(ordersDb, "updateOrder").mockResolvedValue(true);
    const event = vi.spyOn(ordersDb, "insertEvent").mockResolvedValue();
    const result = await actions.approveMcpPreview({ userId: "user-1", keyId: "key-1" }, { orderId: order.id });
    expect(result).toMatchObject({ accepted: true, status: "preview_ready", orderId: order.id });
    expect(update).not.toHaveBeenCalled();
    expect(event).toHaveBeenCalledWith(expect.anything(), order.id, "preview_viewed", expect.objectContaining({ accepted: true }));
  });

  it("runs the remaining tools only for the key's own order", async () => {
    const order = { ...other, userId: "user-1" };
    const ctx = { userId: "user-1", keyId: "key-1" };
    vi.spyOn(storage, "serviceDb").mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: order.id, status: "preview_ready", service_type: "translation", user_id: "user-1", external_ref: null, include_translation: false, eta_at: null, total_cents: 995, currency: "usd", billable_pages: 1 }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as never);
    vi.spyOn(ordersDb, "getOrderById").mockResolvedValue(order as never);
    vi.spyOn(ordersDb, "latestPayment").mockResolvedValue(null);
    vi.spyOn(ordersDb, "getDelivery").mockResolvedValue(null);
    const status = await actions.getMcpOrderStatus(ctx, { orderId: order.id });
    expect(status).toMatchObject({ orderId: order.id, stage: "preview_ready" });

    const listed = await actions.listMcpOrders(ctx, { status: "preview_ready" });
    expect(listed.orders.map((item) => item.orderId)).toEqual([order.id]);
    const hidden = await actions.listMcpOrders(ctx, { status: "translating" });
    expect(hidden.orders).toEqual([]);

    vi.spyOn(previewRead, "previewForOwner").mockResolvedValue({
      body: { translation: { url: "https://files.example/preview.pdf", pageCount: 1, version: 3 }, report: null },
    } as never);
    const preview = await actions.getMcpPreview(ctx, { orderId: order.id });
    expect(preview).toMatchObject({ url: "https://files.example/preview.pdf", watermarked: true });

    vi.spyOn(ordersDb, "listDocuments").mockResolvedValue([{ id: "doc-1" }] as never);
    vi.spyOn(ordersDb, "listPages").mockResolvedValue([]);
    vi.spyOn(customer, "requestPreviewChange").mockResolvedValue({
      id: "corr-1",
      documentId: "doc-1",
      page: 1,
      quote: null,
      note: "The name is wrong",
      status: "correction_requested",
    });
    const change = await actions.requestMcpChanges(ctx, { orderId: order.id, notes: "The name is wrong", page: 1 });
    expect(change).toMatchObject({ note: "The name is wrong", orderId: order.id });
    expect(customer.requestPreviewChange).toHaveBeenCalled();

    vi.spyOn(partner, "partnerFiles").mockResolvedValue({
      downloadAvailable: true,
      originals: [],
      translation: null,
      certification: { url: "https://files.example/certified.pdf", filename: "certified.pdf", expiresInSeconds: 300 },
    });
    const download = await actions.downloadMcpCertified(ctx, { orderId: order.id });
    expect(download.url).toBe("https://files.example/certified.pdf");
    expect(partner.partnerFiles).toHaveBeenCalledWith("user-1", order.id);

    vi.spyOn(verification, "orderVerification").mockResolvedValue([{ status: "valid", type: "translation", issuedAt: "2026-10-31T00:00:00.000Z", documentUrl: "https://files.example/certified.pdf", reference: order.id }]);
    const verified = await actions.verifyMcpCertificate(ctx, { orderId: order.id });
    expect(verified.documents[0]).toMatchObject({ status: "valid", reference: order.id });

    vi.spyOn(integrationsDb, "upsertWebhookEndpoint").mockResolvedValue({
      id: "wh-1",
      userId: "user-1",
      url: "https://example.com/hooks",
      signingSecret: "whsec_secret",
    });
    const hook = await actions.registerMcpWebhook(ctx, { url: "https://example.com/hooks" });
    expect(hook.url).toBe("https://example.com/hooks");
    expect(hook.secret.startsWith("whsec_")).toBe(true);
    expect(integrationsDb.upsertWebhookEndpoint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "user-1" }));

    await expect(actions.submitMcpDocument(ctx, { filename: "a.pdf", ssn: "123", content: "YQ==" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(actions.placeMcpOrder(ctx, { service: "translation", pageCount: 1, sourceLanguage: "es", rush: true, fileIds: ["file-1"] })).rejects.toThrow(/Expedited/);
    await expect(actions.placeMcpOrder(ctx, { service: "translation", pageCount: 1, sourceLanguage: "es", fileIds: [] })).rejects.toThrow(/fileIds/);
  });
});

describe("quickstart config", () => {
  it("points Claude, Cursor, and the OpenAI Agents SDK at the streamable endpoint", () => {
    for (const tab of ["claude", "cursor", "openai"] as const) {
      const text = configFor(tab, "cpk_live_secret");
      expect(text).toContain("https://credpronto.com/api/mcp");
      expect(text).toContain("Bearer cpk_live_secret");
    }
    expect(configFor("openai")).toContain("MCPServerStreamableHttp");
  });
});

function rpc(method: string, params?: unknown): Request {
  return new Request("https://credpronto.com/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
