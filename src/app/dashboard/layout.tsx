import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import { safeNextPath } from "@/lib/auth/redirect";
import { currentPath, getAccount } from "@/lib/account/session";
import { listMyOrders } from "@/lib/api/server";

export const instant = false;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="preview-theme p-8 text-sm text-ink-muted">Loading your orders…</p>}>
      <DashboardGate>{children}</DashboardGate>
    </Suspense>
  );
}

async function DashboardGate({ children }: { children: React.ReactNode }) {
  await connection();
  const account = await getAccount();
  const next = safeNextPath(await currentPath(), "/dashboard");
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const orders = await listMyOrders();
  if (!orders.ok && orders.status === 401) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return (
    <AccountShell
      account={account}
      orders={orders.ok ? orders.data.orders : []}
      ordersError={orders.ok ? null : orders.error}
      // Request time for the translating ETA. It stays fixed for this response.
      // eslint-disable-next-line react-hooks/purity
      now={Date.now()}
    >
      {children}
    </AccountShell>
  );
}
