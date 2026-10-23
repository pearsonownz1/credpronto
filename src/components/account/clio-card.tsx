import { CLIO_CONNECT_PATH, type ClioConnectionState, type ClioNotice } from "@/lib/integrations/clio-connect";
import { partnerStatusLabel, type PartnerApp } from "@/lib/integrations/present";

const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60";
const dangerButton =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-[#b42318] disabled:opacity-60";
const statusBadge =
  "inline-block shrink-0 rounded-[var(--cp-radius)] border border-[#c9d6ff] bg-[#eaf0ff] px-[9px] py-[3px] text-[12px] font-semibold text-primary";

function AppMark({ mark }: { mark: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius)] bg-[#eaf0ff] text-sm font-bold text-primary"
    >
      {mark}
    </span>
  );
}

export function ClioCard({
  app,
  connection,
  notice,
  disconnecting,
  onDisconnect,
}: {
  app: PartnerApp;
  connection: ClioConnectionState;
  notice: ClioNotice | null;
  disconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <li data-testid={`integration-${app.id}`} className="flex flex-wrap items-center gap-3 px-[18px] py-4">
      <AppMark mark={app.mark} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{app.name}</span>
        <span className="mt-0.5 block text-[12.5px] text-ink-muted">{app.description}</span>
        {notice ? (
          <span
            data-testid="clio-notice"
            className={`mt-1 block text-[12.5px] ${notice.tone === "success" ? "text-[#067647]" : "text-[#b42318]"}`}
          >
            {notice.message}
          </span>
        ) : null}
      </span>
      <ClioActions connection={connection} disconnecting={disconnecting} onDisconnect={onDisconnect} />
    </li>
  );
}

export function ClioActions({
  connection,
  disconnecting,
  onDisconnect,
}: {
  connection: ClioConnectionState;
  disconnecting: boolean;
  onDisconnect: () => void;
}) {
  if (connection === "connected") {
    return (
      <span className="inline-flex shrink-0 items-center gap-2">
        <span data-testid="integration-clio-status" className={statusBadge}>
          Connected
        </span>
        <button type="button" data-testid="clio-disconnect" className={dangerButton} disabled={disconnecting} onClick={onDisconnect}>
          Disconnect
        </button>
      </span>
    );
  }
  if (connection === "disconnected") {
    return (
      <a href={CLIO_CONNECT_PATH} data-testid="clio-connect" className={primary}>
        Connect
      </a>
    );
  }
  return (
    <span data-testid="integration-clio-status" className="shrink-0 text-[12.5px] text-ink-muted">
      Loading…
    </span>
  );
}

/** Partner apps that are not live yet. Same badge the Clio card used before connect shipped. */
export function ComingSoonPartnerCard({ app }: { app: PartnerApp }) {
  return (
    <li data-testid={`integration-${app.id}`} className="flex flex-wrap items-center gap-3 px-[18px] py-4">
      <AppMark mark={app.mark} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{app.name}</span>
        <span className="mt-0.5 block text-[12.5px] text-ink-muted">{app.description}</span>
      </span>
      <span data-testid={`integration-${app.id}-status`} className={statusBadge}>
        {partnerStatusLabel("coming_soon")}
      </span>
    </li>
  );
}
