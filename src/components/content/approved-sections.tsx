import Link from "next/link";
import { buttonClasses } from "@/components/flow/ui";
import {
  evaluationsPage,
  homePage,
  splitFirstSection,
} from "@/lib/content/marketing";
import { MarkdownBody } from "./markdown-body";

function GetStarted({ className }: { className: string }) {
  return (
    <Link
      href="/translate"
      data-testid="home-get-started"
      className={buttonClasses("primary", className)}
    >
      Get started
    </Link>
  );
}

export function HomeSections() {
  const { intro, rest } = splitFirstSection(homePage.body);
  return (
    <section data-testid="home-approved" className="border-t border-line">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-12 md:px-16">
        <div className="max-w-[720px]">
          <MarkdownBody source={intro} />
          <GetStarted className="mt-8 h-12 px-6 text-base" />
          {rest ? (
            <div className="mt-12">
              <MarkdownBody source={rest} />
              <GetStarted className="mt-10 h-12 px-6 text-base" />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function EvaluationSections() {
  return (
    <section data-testid="evaluations-approved" className="border-t border-line">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-12 md:px-16">
        <div className="max-w-[720px]">
          <MarkdownBody source={evaluationsPage.body} />
        </div>
      </div>
    </section>
  );
}
