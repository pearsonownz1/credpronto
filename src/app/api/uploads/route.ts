import { ticketFiles, issueUploadSession } from "@/lib/orders/direct-upload";
import { HttpError } from "@/lib/orders/errors";
import { json, run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export async function POST(request: Request) {
  return run(async () => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new HttpError("Expected a JSON body", 400);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("Expected a JSON body", 400);
    }
    const session = await issueUploadSession(serviceDb(), ticketFiles(body));
    return json(session);
  });
}
