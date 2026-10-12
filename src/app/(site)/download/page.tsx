import type { Metadata } from "next";
import { DownloadStates } from "@/components/flow/download-states";

export const metadata: Metadata = {
  title: "Download · CredPronto",
  description: "Download your certified translation and certification page.",
};

export default function DownloadPage() {
  return <DownloadStates />;
}
