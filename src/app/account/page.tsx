import { AccountOrders } from "@/components/account/account-orders";
import { listMyOrders } from "@/lib/api/server";

export const instant = false;

export default async function AccountPage() {
  const orders = await listMyOrders();
  return <AccountOrders orders={orders.ok ? orders.data.orders : []} />;
}
