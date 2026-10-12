import Image from "next/image";
import Link from "next/link";

/** Light wordmark (logo J). White lockup is not used on this theme. */
export function Logo() {
  return (
    <Link href="/" data-testid="logo" className="inline-flex shrink-0 items-center">
      <Image
        src="/brand/credpronto-logo.svg"
        alt="CredPronto"
        width={212}
        height={40}
        unoptimized
        className="h-8 w-auto"
      />
    </Link>
  );
}
