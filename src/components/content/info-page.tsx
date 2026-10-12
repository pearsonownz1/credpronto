import { ContentShell } from "@/components/content/content-page";
import { MarkdownBody } from "@/components/content/markdown-body";

export function InfoPageView({ source }: { source: string }) {
  return (
    <ContentShell>
      <MarkdownBody source={source} />
    </ContentShell>
  );
}
