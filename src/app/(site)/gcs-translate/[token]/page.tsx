import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { GcsHeader } from "@/components/gcs/gcs-header";
import { GcsTranslate } from "@/components/gcs/gcs-translate";
import { GCS_PIN_COOKIE, gcsPinCookieMatches } from "@/lib/gcs/pin";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Certified translation · GEO Credential Services",
  robots: ROBOTS_NOINDEX,
};

export default async function GcsTranslateOrderPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const [{ token }, jar] = await Promise.all([params, cookies()]);
  const unlocked = gcsPinCookieMatches(jar.get(GCS_PIN_COOKIE)?.value);
  return (
    <div data-gcs-flow className="flex h-dvh flex-col bg-white text-[#0b1220]">
      <GcsHeader />
      <GcsTranslate unlocked={unlocked} token={token} />
    </div>
  );
}
