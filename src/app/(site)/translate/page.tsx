import type { Metadata } from "next";
import { UploadView } from "@/components/flow/upload-view";

export const metadata: Metadata = {
  title: "Upload · CredPronto",
  description: "Upload a PDF or phone photos and get an exact price.",
};

export default function TranslatePage() {
  return <UploadView />;
}
