import type { ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { buttonClasses } from "@/components/flow/ui";
import type { FaqBlock, ListItem } from "@/lib/content/marketing-sections";

const rich: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-3">{children}</p>,
  a: ({ href, children }) => {
    if (!href) return <>{children}</>;
    if (href.startsWith("/")) {
      return (
        <Link href={href} className="font-semibold text-primary underline decoration-primary/30 underline-offset-2">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className="font-semibold text-primary underline decoration-primary/30 underline-offset-2"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
};

export function RichText({ source }: { source: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={rich}>
      {source}
    </ReactMarkdown>
  );
}

export function Band({
  id,
  tone,
  labelledBy,
  children,
  className = "",
}: {
  id?: string;
  tone: "white" | "muted" | "blue";
  labelledBy?: string;
  children: ReactNode;
  className?: string;
}) {
  const background =
    tone === "white" ? "bg-white" : tone === "muted" ? "bg-[#f3f6ff]" : "bg-[#eaf0ff]";
  return (
    <section id={id} aria-labelledby={labelledBy} className={background}>
      <div className={`mx-auto w-full max-w-[1280px] px-4 py-16 md:px-16 md:py-20 ${className}`}>
        {children}
      </div>
    </section>
  );
}

export function SectionHeading({
  id,
  kicker,
  children,
}: {
  id: string;
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-[720px]">
      {kicker ? <p className="preview-kicker blue">{kicker}</p> : null}
      <h2
        id={id}
        className={`${kicker ? "mt-3" : ""} text-[32px] leading-[1.12] font-bold tracking-[-0.7px] md:text-[40px]`}
      >
        {children}
      </h2>
    </div>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function UploadIcon() {
  return (
    <Icon>
      <path d="M12 16V5" />
      <path d="M8 8.5 12 4.5 16 8.5" />
      <path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" />
    </Icon>
  );
}

export function ConfirmIcon() {
  return (
    <Icon>
      <path d="M8 6h11" />
      <path d="M8 12h11" />
      <path d="M8 18h11" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </Icon>
  );
}

export function PreviewIcon() {
  return (
    <Icon>
      <rect x="3" y="4" width="7.5" height="16" rx="1.2" />
      <rect x="13.5" y="4" width="7.5" height="16" rx="1.2" />
    </Icon>
  );
}

export function PayIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Icon>
  );
}

export function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 4v10" />
      <path d="M8 10.5 12 14.5 16 10.5" />
      <path d="M5 19h14" />
    </Icon>
  );
}

export function SignIcon() {
  return (
    <Icon>
      <path d="M4 18c2.5-4 4-6 6.5-6 1.6 0 2.2 1.4 3.2 1.4 1.8 0 2.4-3.4 6.3-5.4" />
      <path d="M4 20h16" />
    </Icon>
  );
}

export function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3.5 19 6.2v5.3c0 4.2-2.8 7.2-7 8.9-4.2-1.7-7-4.7-7-8.9V6.2L12 3.5z" />
      <path d="M8.8 12.1 11 14.2 15.3 9.8" />
    </Icon>
  );
}

export function EyeIcon() {
  return (
    <Icon>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

export function MailIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M4 7.5 12 13l8-5.5" />
    </Icon>
  );
}

export function DocIcon() {
  return (
    <Icon>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h5" />
    </Icon>
  );
}

export function stepIcon(title: string) {
  const key = title.toLowerCase();
  if (key.startsWith("upload")) return <UploadIcon />;
  if (key.startsWith("confirm")) return <ConfirmIcon />;
  if (key.startsWith("preview")) return <PreviewIcon />;
  if (key === "pay") return <PayIcon />;
  if (key.startsWith("pay") || key.startsWith("download")) return <DownloadIcon />;
  if (key.startsWith("sign")) return <SignIcon />;
  return <DocIcon />;
}

export function StepStrip({ items }: { items: ListItem[] }) {
  return (
    <ol className="relative mt-10 grid list-none gap-8 p-0 md:grid-cols-4 md:gap-6">
      <span
        aria-hidden
        className="absolute top-[18px] right-[10%] left-[10%] hidden h-px bg-[#d5e0ff] md:block"
      />
      {items.map((item, index) => (
        <li
          key={`${item.lead ?? "step"}-${index}`}
          className="relative flex gap-4 md:flex-col md:gap-4"
        >
          <div className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
            {index + 1}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-primary">{stepIcon(item.lead ?? "")}</span>
              <h3 className="text-[17px] font-bold tracking-[-0.2px]">{item.lead}</h3>
            </div>
            {item.text ? (
              <div className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                <RichText source={item.text} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function FaqList({ items, name }: { items: FaqBlock[]; name: string }) {
  return (
    <div className="mt-8 border-y border-[#e1e8ff]">
      {items.map((item) => (
        <details key={item.question} name={name} className="group border-b border-[#e1e8ff] last:border-b-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-semibold tracking-[-0.2px] [&::-webkit-details-marker]:hidden">
            {item.question}
            <span
              aria-hidden
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-white text-lg leading-none text-primary group-open:bg-primary group-open:text-white"
            >
              <span className="group-open:hidden">+</span>
              <span className="hidden group-open:inline">–</span>
            </span>
          </summary>
          <div className="max-w-[720px] pb-5 text-[16px] leading-relaxed text-ink-muted">
            <RichText source={item.answer} />
          </div>
        </details>
      ))}
    </div>
  );
}

export function CtaBand({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <Band tone="blue" labelledBy="closing-cta">
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-[640px]">
          <h2 id="closing-cta" className="text-[32px] leading-[1.12] font-bold tracking-[-0.7px] md:text-[40px]">
            {title}
          </h2>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-muted">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </Band>
  );
}

export function PrimaryLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Link href={href} data-testid={testId} className={buttonClasses("primary", "h-12 px-6 text-base")}>
      {children}
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClasses("secondary", "h-12 px-6 text-base")}>
      {children}
    </Link>
  );
}
