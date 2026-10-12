import type { Metadata } from "next";
import { UploadView } from "@/components/flow/upload-view";

export const metadata: Metadata = {
  title: "Upload · CredPronto",
  description: "Upload a PDF or phone photos and get an exact price.",
};

export default async function TranslatePage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string | string[] }>;
}) {
  const params = await searchParams;
  const service = Array.isArray(params.service) ? params.service[0] : params.service;
  return <UploadView initialService={service} />;
}
