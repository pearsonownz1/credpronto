import Script from "next/script";
import { googleAdsId, googleAdsInlineSnippet, googleAdsScriptSrc } from "@/lib/analytics/google-ads";

export function GoogleAds() {
  const id = googleAdsId();
  return (
    <>
      <Script src={googleAdsScriptSrc(id)} strategy="afterInteractive" />
      <Script id="google-ads-gtag" strategy="afterInteractive">
        {googleAdsInlineSnippet(id)}
      </Script>
    </>
  );
}
