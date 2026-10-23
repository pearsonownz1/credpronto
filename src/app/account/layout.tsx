import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { currentPath, getAccount } from "@/lib/account/session";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Account · CredPronto",
  robots: ROBOTS_NOINDEX,
};

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const account = await getAccount();
  const next = safeNextPath(await currentPath(), "/dashboard");
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return children;
}
