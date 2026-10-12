import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-5xl items-center px-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-ink"
        >
          CredPronto
        </Link>
      </div>
    </header>
  );
}
