import type { Metadata } from "next";
import { InfoPageView } from "@/components/content/info-page";
import { infoMetadata, loadInfoPage } from "@/lib/content/info-pages";

const page = loadInfoPage("about");

export const metadata: Metadata = infoMetadata("about");

export default function AboutPage() {
  return <InfoPageView source={page.body} />;
}
