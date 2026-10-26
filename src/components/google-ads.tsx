import Script from "next/script";
import {
  gaMeasurementId,
  googleAdsId,
  googleAdsInlineSnippet,
  googleAdsScriptSrc,
} from "@/lib/analytics/google-ads";

export function GoogleAds() {
  const id = googleAdsId();
  const measurementId = gaMeasurementId();
  return (
    <>
      <Script src={googleAdsScriptSrc(id)} strategy="afterInteractive" />
      <Script id="google-ads-gtag" strategy="afterInteractive">
        {googleAdsInlineSnippet(id, measurementId)}
      </Script>
    </>
  );
}
