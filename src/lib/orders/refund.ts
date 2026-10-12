import Stripe from "stripe";
import { requireStaff } from "./staff";
import { getOrderById, hasEvent, insertEvent, markPaymentRefunded, paymentForRefund } from "./db";
import { HttpError } from "./errors";
import { planRefund } from "./refund-plan";

export async function refundOrder(orderId: string) {
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);

  const payment = await paymentForRefund(db, order.id);
  const plan = planRefund({
    paymentStatus: payment?.status ?? null,
    paymentIntentId: payment?.paymentIntentId ?? null,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  });

  if (plan.action === "reject") throw new HttpError(plan.error, plan.status);
  if (plan.action === "duplicate") {
    return { paymentStatus: "refunded" as const, duplicate: true };
  }
  if (!payment) throw new HttpError("This order has no settled payment", 409);

  let refundId: string | null = null;
  let mode: "paid_test" | "stripe" = "paid_test";
  if (plan.action === "stripe") {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
      const refund = await stripe.refunds.create({
        payment_intent: plan.paymentIntentId,
        metadata: { order_id: order.id },
      });
      refundId = refund.id;
      mode = "stripe";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stripe refund failed";
      throw new HttpError(message, 502);
    }
  }

  await markPaymentRefunded(db, payment.id);
  if (!(await hasEvent(db, order.id, "refunded"))) {
    await insertEvent(db, order.id, "refunded", {
      mode,
      actorId: userId,
      ...(refundId ? { refundId } : {}),
    });
  }

  return {
    paymentStatus: "refunded" as const,
    mode,
    duplicate: false,
    ...(refundId ? { refundId } : {}),
  };
}
