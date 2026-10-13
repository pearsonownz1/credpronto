import { TranslationLanding } from "@/components/content/translation-landing";
import { MarketingHeader } from "./marketing-header";

export function LandingView() {
  return (
    <div>
      <MarketingHeader section="translations" />
      <main>
        <TranslationLanding />
      </main>
    </div>
  );
}
