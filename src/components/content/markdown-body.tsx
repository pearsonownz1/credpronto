import type { ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { buttonClasses } from "@/components/flow/ui";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textContent(props?.children);
  }
  return "";
}

const components: Components = {
  a: ({ href, children }) => {
    const label = textContent(children).trim();
    if (href === "/translate" && label.startsWith("Get your free preview")) {
      return (
        <Link href="/translate" className={buttonClasses("primary", "mt-2 h-12 px-6 text-base no-underline")}>
          {label}
        </Link>
      );
    }
    if (href?.startsWith("/")) {
      return (
        <Link href={href} className="font-semibold text-primary underline">
          {children}
        </Link>
      );
    }
    return (
      <a href={href} className="font-semibold text-primary underline" rel="noreferrer">
        {children}
      </a>
    );
  },
  h1: ({ children }) => <h1 className="text-4xl font-bold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-10 text-2xl font-bold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-8 text-xl font-bold tracking-tight">{children}</h3>,
  p: ({ children }) => <p className="mt-4 text-[17px] leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-6 rounded-[var(--cp-radius)] border-l-4 border-primary bg-bg-muted px-4 py-3 [&_p]:text-[16px]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-line" />,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-[var(--cp-radius)] border border-line">
      <table className="w-full border-collapse text-left text-[15px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="bg-bg-muted px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-line px-3 py-2 align-top">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
};

export function MarkdownBody({ source }: { source: string }) {
  return (
    <div className="text-[17px] leading-relaxed text-ink [&>h1:first-child]:mt-0 [&>h2:first-child]:mt-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
