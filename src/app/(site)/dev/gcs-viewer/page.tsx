import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GcsViewerFixture } from "@/components/preview/gcs-viewer-fixture";
import { paidReviewFixtureEnabled } from "@/lib/dev/paid-review-fixture";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Viewer fixture · CredPronto",
  description: "Fixture for the three-pane document viewer.",
  robots: ROBOTS_NOINDEX,
};

export default async function GcsViewerFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ ready?: string }>;
}) {
  if (!paidReviewFixtureEnabled()) notFound();
  const { ready } = await searchParams;
  return <GcsViewerFixture initialEvaluation={ready === "1"} />;
}
