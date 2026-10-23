import { json, run } from "@/lib/orders/http";
import { listStaffOrderFiles, staffDownloadFile } from "@/lib/orders/staff-download";

type Context = { params: Promise<{ id: string }> };

/** Staff only: list the order's delivered files and evaluation reports. */
export async function GET(_request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await listStaffOrderFiles(id));
  });
}

/** Staff only: log the download, then return a short-lived signed URL for one file. */
export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    return json(await staffDownloadFile(id, body));
  });
}
