import { readJson } from "@/lib/auth/body";
import { json, run } from "@/lib/orders/http";
import { setVerificationRevoked } from "@/lib/orders/verification";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return run(async () => {
    const { id } = await context.params;
    return json(await setVerificationRevoked(id, await readJson(request)));
  });
}
