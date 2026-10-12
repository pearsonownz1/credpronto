import type { Metadata } from "next";
import { InfoPageView } from "@/components/content/info-page";
import { infoMetadata, loadInfoPage } from "@/lib/content/info-pages";

const page = loadInfoPage("privacy");

export const metadata: Metadata = infoMetadata("privacy");

export default function PrivacyPage() {
  return <InfoPageView source={page.body} />;
}
