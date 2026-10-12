import Link from "next/link";

type WordmarkProps = {
  href?: string;
  className?: string;
};

/**
 * The only CredPronto mark in this app.
 * A separate PR adds the shared Logo component and public/brand assets.
 * When that PR is on main, replace this body with the shared Logo.
 */
export function Wordmark({ href = "/", className }: WordmarkProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 text-lg font-bold tracking-[-0.4px] text-ink ${className ?? ""}`}
    >
      <span
        className="relative inline-block size-[22px] shrink-0 rounded-[3px] bg-primary"
        aria-hidden
      >
        <span className="absolute top-[5px] left-[6px] h-[11px] w-2 rounded-r-[6px] border-[2.5px] border-l-0 border-white" />
      </span>
      CredPronto
    </Link>
  );
}
