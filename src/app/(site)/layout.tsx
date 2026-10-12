import { ReadingHandoff } from "@/components/flow/reading-handoff";

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="preview-theme flex min-h-full flex-1 flex-col bg-bg text-ink">
      <ReadingHandoff>{children}</ReadingHandoff>
    </div>
  );
}
