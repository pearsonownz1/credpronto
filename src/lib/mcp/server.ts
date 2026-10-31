import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { HttpError } from "@/lib/orders/errors";
import { MCP_TOOL_DOCS } from "./docs";
import {
  approveMcpPreview,
  downloadMcpCertified,
  getMcpOrderStatus,
  getMcpPreview,
  getQuote,
  listMcpOrders,
  listServices,
  placeMcpOrder,
  registerMcpWebhook,
  requestMcpChanges,
  submitMcpDocument,
  verifyMcpCertificate,
  type McpContext,
} from "./actions";

const MAX_BODY = 70 * 1024 * 1024;

const language = z.string().min(2).max(16);
const id = z.string().min(1).max(80);

const quoteShape = {
  service: z.enum(["translation", "evaluation"]),
  evaluationType: z.enum(["diploma", "course_by_course"]).optional(),
  pageCount: z.number().int().positive().optional(),
  degreeCount: z.number().int().positive().max(5).optional(),
  sourceLanguage: language.optional(),
  targetLanguage: language.optional(),
  includeTranslation: z.boolean().optional(),
  rush: z.boolean().optional(),
};

const tools: Array<{
  name: (typeof MCP_TOOL_DOCS)[number]["name"];
  description: string;
  schema: z.ZodType;
  run: (args: unknown, ctx: McpContext) => Promise<unknown>;
}> = [
  { name: "list_services", description: MCP_TOOL_DOCS[0].description, schema: z.object({}).strict(), run: async () => listServices() },
  { name: "get_quote", description: MCP_TOOL_DOCS[1].description, schema: z.object(quoteShape).strict(), run: async (args) => getQuote(args) },
  {
    name: "submit_document",
    description: MCP_TOOL_DOCS[2].description,
    schema: z.object({ filename: z.string().min(1).max(180), content: z.string().optional(), url: z.string().optional(), mime: z.string().max(120).optional() }).strict(),
    run: (args, ctx) => submitMcpDocument(ctx, args),
  },
  {
    name: "create_order",
    description: MCP_TOOL_DOCS[3].description,
    schema: z.object({ ...quoteShape, fileIds: z.array(id).min(1).max(15), externalRef: z.string().max(200).optional() }).strict(),
    run: (args, ctx) => placeMcpOrder(ctx, args),
  },
  { name: "get_order_status", description: MCP_TOOL_DOCS[4].description, schema: z.object({ orderId: id }).strict(), run: (args, ctx) => getMcpOrderStatus(ctx, args) },
  { name: "list_orders", description: MCP_TOOL_DOCS[5].description, schema: z.object({ status: z.string().max(40).optional() }).strict(), run: (args, ctx) => listMcpOrders(ctx, args) },
  { name: "get_preview", description: MCP_TOOL_DOCS[6].description, schema: z.object({ orderId: id }).strict(), run: (args, ctx) => getMcpPreview(ctx, args) },
  { name: "approve_preview", description: MCP_TOOL_DOCS[7].description, schema: z.object({ orderId: id }).strict(), run: (args, ctx) => approveMcpPreview(ctx, args) },
  {
    name: "request_changes",
    description: MCP_TOOL_DOCS[8].description,
    schema: z.object({ orderId: id, notes: z.string().min(1).max(4000), documentId: id.optional(), page: z.number().int().positive().optional() }).strict(),
    run: (args, ctx) => requestMcpChanges(ctx, args),
  },
  { name: "download_certified", description: MCP_TOOL_DOCS[9].description, schema: z.object({ orderId: id }).strict(), run: (args, ctx) => downloadMcpCertified(ctx, args) },
  {
    name: "verify_certificate",
    description: MCP_TOOL_DOCS[10].description,
    schema: z.object({ orderId: id.optional(), documentHash: z.string().length(64).optional() }).strict(),
    run: (args, ctx) => verifyMcpCertificate(ctx, args),
  },
  {
    name: "register_webhook",
    description: MCP_TOOL_DOCS[11].description,
    schema: z.object({ url: z.string().min(8).max(500) }).strict(),
    run: (args, ctx) => registerMcpWebhook(ctx, args),
  },
];

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolFailure(error: unknown) {
  if (!(error instanceof HttpError)) console.error(error instanceof Error ? error.message : "mcp tool failed");
  const body =
    error instanceof HttpError
      ? { error: error.message, ...(error.code ? { code: error.code } : {}), ...error.details }
      : { error: "Something went wrong" };
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }], isError: true as const };
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({ name: "credpronto", version: "1.0.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.name !== "submit_document" && tool.name !== "create_order" && tool.name !== "approve_preview" && tool.name !== "request_changes" && tool.name !== "register_webhook",
        },
      },
      async (args: unknown) => {
        try {
          return toolResult(await tool.run(args, ctx));
        } catch (error) {
          return toolFailure(error);
        }
      },
    );
  }
  return server;
}

export async function handleMcpRequest(request: Request, ctx: McpContext): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
