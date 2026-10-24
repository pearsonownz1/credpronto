import Image from "next/image";

export function GcsHeader() {
  return (
    <header className="shrink-0 border-b border-[#d5dbe6] bg-white">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-4 px-5 pt-4 md:px-8">
        <Image
          src="/gcs/gcs-logo.png"
          alt="GEO Credential Services"
          width={492}
          height={141}
          priority
          className="h-11 w-auto md:h-14"
        />
        <div className="text-right">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#5b6474]">CORPORATE MEMBER OF</p>
          <Image
            src="/gcs/ata-logo.png"
            alt="American Translators Association"
            width={603}
            height={100}
            priority
            className="ml-auto mt-1 h-7 w-auto md:h-9"
          />
        </div>
      </div>
      <p className="px-5 pt-3 text-center text-[13px] text-[#5b6474]">
        <a href="mailto:support@gcs.org" className="hover:text-[#1f5eff]">
          support@gcs.org
        </a>
        <span className="px-2" aria-hidden>
          |
        </span>
        <a href="https://www.gcs.org" className="hover:text-[#1f5eff]">
          www.gcs.org
        </a>
      </p>
      <div className="mx-auto mt-3 h-[3px] max-w-6xl bg-[#0b1220]" />
    </header>
  );
}
