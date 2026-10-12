import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 items-center bg-bg-muted">
      <div className="mx-auto w-full max-w-5xl px-6 py-24">
        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Your documents. Ready, pronto.
        </h1>
        <p className="mt-5 max-w-lg text-lg leading-8 text-ink-muted">
          Certified translations from $9.95/page. Preview yours before paying.
        </p>
        <Link
          href="/translate"
          className="mt-8 inline-flex h-11 items-center justify-center rounded-[var(--cp-radius)] bg-primary px-5 text-sm font-medium text-primary-ink hover:bg-primary-hover"
        >
          Get your free preview
        </Link>
      </div>
    </main>
  );
}
