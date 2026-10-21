import Image from "next/image";

export function TranslationPreview() {
  return (
    <figure data-testid="translation-preview" className="min-w-0">
      <Image
        src="/images/hero-docs.png"
        alt="CredPronto side-by-side preview of a Turkish tax letter and its certified English translation"
        width={1583}
        height={1088}
        preload
        sizes="(min-width: 768px) 560px, 100vw"
        className="h-auto w-full"
      />
    </figure>
  );
}
