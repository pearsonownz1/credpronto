import Stripe from "stripe";
import { HttpError } from "@/lib/orders/errors";
import { billingCustomerForUser, insertBillingCustomer, setBillingTerms } from "@/lib/orders/integrations-db";
import { json, run } from "@/lib/orders/http";
import { requireStaff } from "@/lib/orders/staff";
import { requireStripeSecret } from "@/lib/orders/saved-card";

type Context = { params: Promise<{ userId: string }> };

/** Staff sets card or net-terms billing for one customer. */
export async function PATCH(request: Request, context: Context) {
  return run(async () => {
    const staff = await requireStaff();
    const { userId } = await context.params;
    const body = await request.json().catch(() => null);
    const terms = body && typeof body === "object" ? (body as { terms?: unknown }).terms : null;
    if (terms !== "card" && terms !== "net") {
      throw new HttpError("terms must be card or net", 400, "validation_error");
    }
    const db = staff.db;
    let row = await billingCustomerForUser(db, userId);
    if (!row) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data.user) throw new HttpError("Customer not found", 404);
      const stripe = new Stripe(requireStripeSecret());
      const customer = await stripe.customers.create({
        email: data.user.email ?? undefined,
        metadata: { user_id: userId },
      });
      await insertBillingCustomer(db, userId, customer.id);
      row = await billingCustomerForUser(db, userId);
      if (!row) throw new HttpError("Customer not found", 404);
    }
    const saved = await setBillingTerms(db, userId, terms);
    if (!saved) throw new HttpError("Customer not found", 404);
    return json({ userId, terms });
  });
}
