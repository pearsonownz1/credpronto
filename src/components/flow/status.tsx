import type { ReactNode } from "react";

export function FlowStatus({
  kicker,
  title,
  body,
  action,
  testId,
}: {
  kicker?: string;
  title: string;
  body: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="mx-auto w-full max-w-[620px] px-4 py-16 text-center">
      {kicker ? <p className="preview-kicker blue">{kicker}</p> : null}
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">{title}</h1>
      {body ? <p className="mt-3 text-base text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
