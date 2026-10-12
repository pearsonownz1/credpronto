import { Suspense } from "react";
import Link from "next/link";
import { SiteAccountMenu } from "@/components/account/site-account-menu";
import { Wordmark } from "@/components/wordmark";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
        <Wordmark />
        <Suspense
          fallback={
            <Link href="/sign-in" className="text-sm font-semibold text-ink">
              Sign in
            </Link>
          }
        >
          <SiteAccountMenu />
        </Suspense>
      </div>
    </header>
  );
}
