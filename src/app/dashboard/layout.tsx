import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/account-shell";
import type { Account } from "@/lib/account/names";
import { safeNextPath } from "@/lib/auth/redirect";
import { currentPath, getAccount } from "@/lib/account/session";
import { attachDashboardLanguages } from "@/lib/account/order-languages";
import { listMyOrders } from "@/lib/api/server";

export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Read the session before any Suspense shell. A redirect inside the shell
  // is a client navigation on a publicly cached 200.
  const account = await getAccount();
  const next = safeNextPath(await currentPath(), "/dashboard");
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(next)}`);

  return (
    <Suspense fallback={<p className="preview-theme p-8 text-sm text-ink-muted">Loading your orders…</p>}>
      <DashboardGate account={account} next={next}>
        {children}
      </DashboardGate>
    </Suspense>
  );
}

async function DashboardGate({
  account,
  next,
  children,
}: {
  account: Account;
  next: string;
  children: React.ReactNode;
}) {
  await connection();
  const listed = await listMyOrders();
  if (!listed.ok && listed.status === 401) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  const orders = listed.ok ? await attachDashboardLanguages(listed.data.orders) : [];
  return (
    <AccountShell
      account={account}
      orders={orders}
      ordersError={listed.ok ? null : listed.error}
      // Request time for the translating ETA. It stays fixed for this response.
      // eslint-disable-next-line react-hooks/purity
      now={Date.now()}
    >
      {children}
    </AccountShell>
  );
}
