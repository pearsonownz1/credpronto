import type { Metadata } from "next";
import { connection } from "next/server";
import { VerifyExperience } from "@/components/verify/verify-experience";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Verify document · CredPronto",
  description: "Confirm that a document was issued by CredPronto.",
  robots: ROBOTS_NOINDEX,
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // The token is an access key. Wait for the request so this page is not cached.
  await connection();
  return <VerifyExperience token={token} />;
}
