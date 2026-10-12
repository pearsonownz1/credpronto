import type { Metadata } from "next";
import { ContactView } from "@/components/contact/contact-view";
import { infoMetadata } from "@/lib/content/info-pages";

export const metadata: Metadata = infoMetadata("contact");

export default function ContactPage() {
  return <ContactView />;
}
