import type { Metadata } from "next";
import { DownloadView } from "@/components/flow/download-view";

export const metadata: Metadata = {
  title: "Download · CredPronto",
  description: "Download your certified translation and the original file.",
};

export default function DownloadPage() {
  return <DownloadView />;
}
