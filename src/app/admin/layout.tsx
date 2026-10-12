import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { Forbidden } from "@/components/admin/forbidden";
import { safeNextPath } from "@/lib/auth/redirect";
import { currentPath, getAccount } from "@/lib/account/session";
import { listAdminOrders } from "@/lib/api/server";

export const instant = false;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="preview-theme p-8 text-sm text-ink-muted">Loading admin…</p>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  const account = await getAccount();
  const next = safeNextPath(await currentPath(), "/admin");
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(next)}`);

  const probe = await listAdminOrders({ limit: 1 });
  if (!probe.ok && probe.status === 401) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!probe.ok && probe.status === 403) return <Forbidden />;

  return <AdminShell account={account}>{children}</AdminShell>;
}
