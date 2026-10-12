import type { Metadata } from "next";
import { InfoPageView } from "@/components/content/info-page";
import { infoMetadata, loadInfoPage } from "@/lib/content/info-pages";

const page = loadInfoPage("contact");

export const metadata: Metadata = infoMetadata("contact");

export default function ContactPage() {
  return <InfoPageView source={page.body} />;
}
