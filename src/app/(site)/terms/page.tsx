import type { Metadata } from "next";
import { InfoPageView } from "@/components/content/info-page";
import { infoMetadata, loadInfoPage } from "@/lib/content/info-pages";

const page = loadInfoPage("terms");

export const metadata: Metadata = infoMetadata("terms");

export default function TermsPage() {
  return <InfoPageView source={page.body} />;
}
