import { TranslationLanding } from "@/components/content/translation-landing";
import { getAccount } from "@/lib/account/session";
import { MarketingHeader } from "./marketing-header";

export async function LandingView() {
  const account = await getAccount();
  return (
    <div>
      <MarketingHeader section="translations" />
      <main>
        <TranslationLanding signedIn={Boolean(account)} />
      </main>
    </div>
  );
}
