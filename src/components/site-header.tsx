import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-5xl items-center px-6">
        <Link href="/" className="inline-flex items-center">
          <Logo priority />
        </Link>
      </div>
    </header>
  );
}
