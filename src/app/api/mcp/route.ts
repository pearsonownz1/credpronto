import { HttpError } from "@/lib/orders/errors";
import { json } from "@/lib/orders/http";
import { handleMcpRequest } from "@/lib/mcp/server";
import { requireMcpKey } from "@/lib/mcp/actions";

export const maxDuration = 300;

async function authenticated(request: Request): Promise<Response> {
  try {
    const key = await requireMcpKey(request);
    return await handleMcpRequest(request, { userId: key.userId, keyId: key.id });
  } catch (error) {
    if (error instanceof HttpError) {
      const response = json(
        { error: error.message, ...(error.code ? { code: error.code } : {}), ...error.details },
        error.status,
      );
      const retry = error.details.retryAfterSeconds;
      if (typeof retry === "number" && Number.isInteger(retry) && retry > 0) {
        response.headers.set("Retry-After", String(retry));
      }
      return response;
    }
    console.error(error instanceof Error ? error.message : "mcp failed");
    return json({ error: "Something went wrong" }, 500);
  }
}

export function GET(request: Request) {
  return authenticated(request);
}

export function POST(request: Request) {
  return authenticated(request);
}

export function DELETE(request: Request) {
  return authenticated(request);
}
