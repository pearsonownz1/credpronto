import Image from "next/image";

const sources = {
  default: "/brand/credpronto-logo.svg",
  white: "/brand/credpronto-logo-white.svg",
} as const;

export function Logo({
  variant = "default",
  className = "h-8 w-auto shrink-0",
  priority = false,
}: {
  variant?: keyof typeof sources;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={sources[variant]}
      alt="CredPronto"
      width={212}
      height={40}
      priority={priority}
      className={className}
    />
  );
}
