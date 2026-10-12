import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-bg">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-ink-muted">
        <Link href="/" className="inline-flex items-center">
          <Logo />
        </Link>
        <p>Certified translations. Preview before you pay.</p>
      </div>
    </footer>
  );
}
