import type { Metadata } from "next";
import { UploadView } from "@/components/flow/upload-view";
import { TRANSLATE_CANONICAL, TRANSLATE_DESCRIPTION, TRANSLATE_TITLE } from "@/lib/seo";

export const metadata: Metadata = {
  title: TRANSLATE_TITLE,
  description: TRANSLATE_DESCRIPTION,
  alternates: {
    canonical: TRANSLATE_CANONICAL,
  },
};

export default function TranslatePage() {
  return <UploadView />;
}
