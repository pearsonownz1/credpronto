import Link from "next/link";

export function Mark() {
  return (
    <span
      className="relative inline-block size-[22px] shrink-0 rounded-[3px] bg-primary"
      aria-hidden
    >
      <span className="absolute top-[5px] left-[6px] h-[11px] w-2 rounded-r-[6px] border-[2.5px] border-l-0 border-white" />
    </span>
  );
}

export function Logo() {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center gap-2 text-[18px] font-bold tracking-[-0.4px] text-ink"
    >
      <Mark />
      CredPronto
    </Link>
  );
}
