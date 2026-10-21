import { Suspense } from "react";
import { TranslationLanding } from "@/components/content/translation-landing";
import { getAccount } from "@/lib/account/session";
import { MarketingHeader } from "./marketing-header";

export function LandingView() {
  return (
    <div>
      <MarketingHeader section="translations" />
      <main>
        <Suspense fallback={<TranslationLanding signedIn={false} />}>
          <SignedInLanding />
        </Suspense>
      </main>
    </div>
  );
}

async function SignedInLanding() {
  const account = await getAccount();
  return <TranslationLanding signedIn={Boolean(account)} />;
}
