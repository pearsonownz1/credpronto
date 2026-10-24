import { privatePreEvalResponse } from "@/lib/pre-evaluation/http";
import { previewDownloadName, readPreEvaluationPreview } from "@/lib/pre-evaluation/run";
import { run } from "@/lib/orders/http";
import { serviceDb } from "@/lib/orders/storage";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const response = await run(async () => {
    const { id } = await context.params;
    const file = await readPreEvaluationPreview(serviceDb(), id, request);
    return new Response(Buffer.from(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `inline; filename="${previewDownloadName(file.mime)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  return privatePreEvalResponse(response);
}
