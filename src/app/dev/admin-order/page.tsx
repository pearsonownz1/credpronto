import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { OrderStudio } from "@/components/admin/order-studio";
import { MOCK_ADMIN_EMAIL } from "@/lib/account/mock-data";
import { mockAccountFor } from "@/lib/account/names";
import { adminOrderFixtureDetail, adminOrderFixtureEnabled } from "@/lib/dev/admin-order-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Admin order · CredPronto",
  description: "Fixture for evaluation report uploads on an admin order.",
  robots: ROBOTS_NOINDEX,
};

export default function AdminOrderFixturePage() {
  if (!adminOrderFixtureEnabled()) notFound();
  return (
    <AdminShell account={mockAccountFor(MOCK_ADMIN_EMAIL)}>
      <OrderStudio detail={adminOrderFixtureDetail()} notes={[]} notesError={null} />
    </AdminShell>
  );
}
