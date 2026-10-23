import type { Metadata } from "next";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Verify document · CredPronto",
  description: "Confirm that a document was issued by CredPronto.",
  robots: ROBOTS_NOINDEX,
};

export default function VerifyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="preview-theme flex flex-1 flex-col bg-bg text-ink">{children}</div>;
}
