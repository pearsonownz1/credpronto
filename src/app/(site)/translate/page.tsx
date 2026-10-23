import type { Metadata } from "next";
import { Suspense } from "react";
import { getAccount } from "@/lib/account/session";
import { UploadExperience, UploadSeed } from "@/components/flow/upload-view";
import { TRANSLATE_CANONICAL, TRANSLATE_DESCRIPTION, TRANSLATE_TITLE } from "@/lib/seo";

export const metadata: Metadata = {
  title: TRANSLATE_TITLE,
  description: TRANSLATE_DESCRIPTION,
  alternates: {
    canonical: TRANSLATE_CANONICAL,
  },
};

export default function TranslatePage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string | string[]; preEvaluation?: string | string[] }>;
}) {
  return (
    <UploadExperience
      seed={
        <Suspense fallback={null}>
          <TranslateUpload searchParams={searchParams} />
        </Suspense>
      }
    />
  );
}

async function TranslateUpload({
  searchParams,
}: {
  searchParams: Promise<{ service?: string | string[]; preEvaluation?: string | string[] }>;
}) {
  const [params, account] = await Promise.all([searchParams, getAccount()]);
  const service = Array.isArray(params.service) ? params.service[0] : params.service;
  const preEvaluation = Array.isArray(params.preEvaluation) ? params.preEvaluation[0] : params.preEvaluation;
  return (
    <UploadSeed
      initialService={service}
      sessionEmail={account?.email ?? null}
      preEvaluationId={preEvaluation ?? null}
    />
  );
}
