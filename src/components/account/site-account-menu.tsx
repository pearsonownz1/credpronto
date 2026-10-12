import Link from "next/link";
import { HeaderAccountMenu } from "@/components/account/header-account-menu";
import { getAccount } from "@/lib/account/session";

export async function SiteAccountMenu() {
  const account = await getAccount();
  if (!account) {
    return (
      <Link href="/sign-in" className="text-sm font-semibold text-ink">
        Sign in
      </Link>
    );
  }
  return <HeaderAccountMenu account={account} />;
}
