import Link from "next/link";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { BRAND_LOCALITY, BRAND_STREET } from "@/lib/orders/brand";
import { CONTACT_TO } from "@/lib/contact/validate";
import { ContactForm } from "./contact-form";

const outlineButton =
  "inline-flex h-11 items-center justify-center rounded-[4px] border-[1.5px] border-[#1F5EFF] bg-white px-5 text-sm font-semibold text-[#1F5EFF] hover:bg-[#EEF3FF]";

export function ContactPageBody() {
  return (
    <>
      <section className="border-b border-[#E1E8FF] bg-[#F3F6FF]">
        <div className="mx-auto max-w-[1040px] px-4 py-14 text-center md:px-6 md:py-16">
          <h1 className="text-[36px] font-extrabold leading-[1.1] tracking-[-0.8px] text-ink md:text-[44px]">
            We&apos;d love to hear from you
          </h1>
          <p className="mx-auto mt-4 max-w-[640px] text-[17px] leading-normal text-ink-muted">
            Questions about an order or a document? Send us a note and our team will reply within
            one business day.
          </p>
        </div>
      </section>
      <div className="mx-auto grid w-full max-w-[1040px] gap-10 px-4 py-12 md:px-6 md:py-16 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ContactForm />
        <aside className="h-fit rounded-[4px] border border-[#E6E9F0] bg-white p-[26px]">
          <p className="preview-kicker">Get in touch</p>
          <ul className="mt-5 grid gap-5">
            <li className="flex gap-3">
              <IconTile>
                <MailIcon />
              </IconTile>
              <div className="min-w-0 pt-0.5">
                <a href={`mailto:${CONTACT_TO}`} className="font-semibold break-all text-ink hover:text-[#1F5EFF]">
                  {CONTACT_TO}
                </a>
                <p className="mt-0.5 text-sm text-ink-muted">Replies within one business day</p>
              </div>
            </li>
            <li className="flex gap-3">
              <IconTile>
                <PinIcon />
              </IconTile>
              <p className="pt-0.5 text-sm leading-relaxed text-ink">
                {BRAND_STREET}
                <br />
                {BRAND_LOCALITY}
              </p>
            </li>
          </ul>
          <p className="mt-6 border-t border-[#E6E9F0] pt-4 text-sm leading-relaxed text-ink-muted">
            Have an order? Include your order number so we can help faster.
          </p>
        </aside>
      </div>
      <section className="bg-[#F7F8FA]">
        <div className="mx-auto max-w-[1040px] px-4 py-14 text-center md:px-6">
          <h2 className="text-[30px] font-extrabold tracking-[-0.4px] text-ink">
            Looking for a quick answer?
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/faq" className={outlineButton}>
              Read the FAQ
            </Link>
            <Link href="/guides" className={outlineButton}>
              Browse guides
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function ContactView() {
  return (
    <div>
      <MarketingHeader />
      <ContactPageBody />
    </div>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[4px] bg-[#EEF3FF] text-[#1F5EFF]">
      {children}
    </span>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
