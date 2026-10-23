import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CLIO_CONNECTED_NOTICE, CLIO_ERROR_NOTICE } from "@/lib/integrations/clio-connect";
import { PARTNER_APPS } from "@/lib/integrations/present";
import { ClioCard, ComingSoonPartnerCard } from "./clio-card";

const clio = PARTNER_APPS[0];
const description = "Send evaluation and translation orders from a Clio matter and save finished reports back to it.";

function clioHtml(connection: "loading" | "connected" | "disconnected", notice: { tone: "success" | "error"; message: string } | null = null) {
  return renderToStaticMarkup(
    createElement(ClioCard, {
      app: clio,
      connection,
      notice,
      disconnecting: false,
      onDisconnect: () => undefined,
    }),
  );
}

describe("Clio card", () => {
  it("shows Connect to the Clio connect route when disconnected", () => {
    const html = clioHtml("disconnected");
    expect(html).toContain("Clio");
    expect(html).toContain(">C<");
    expect(html).toContain(description);
    expect(html).toContain('href="/api/integrations/clio/connect"');
    expect(html).toContain(">Connect<");
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("<button");
    expect(html.toLowerCase()).not.toContain("oauth");
  });

  it("shows Connected and Disconnect when status says connected", () => {
    const html = clioHtml("connected");
    expect(html).toContain('data-testid="integration-clio-status"');
    expect(html).toContain("Connected");
    expect(html).toContain('data-testid="clio-disconnect"');
    expect(html).toContain(">Disconnect<");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain('href="/api/integrations/clio/connect"');
    expect(html).toContain(description);
  });

  it("shows a fixed success or error notice without a coming-soon label", () => {
    const success = clioHtml("connected", { tone: "success", message: CLIO_CONNECTED_NOTICE });
    expect(success).toContain('data-testid="clio-notice"');
    expect(success).toContain(CLIO_CONNECTED_NOTICE);
    expect(success).not.toContain("Coming soon");

    const error = clioHtml("disconnected", { tone: "error", message: CLIO_ERROR_NOTICE });
    expect(error).toContain(CLIO_ERROR_NOTICE);
    expect(error).not.toContain("access_denied");
    expect(error).not.toContain("Coming soon");
  });

  it("leaves other partner apps on the coming-soon badge with no connect control", () => {
    const html = renderToStaticMarkup(
      createElement(ComingSoonPartnerCard, {
        app: {
          id: "other",
          name: "Other",
          description: "Later.",
          mark: "O",
          status: "coming_soon",
        },
      }),
    );
    expect(html).toContain('data-testid="integration-other-status"');
    expect(html).toContain("Coming soon");
    expect(html).toContain("Later.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html.toLowerCase()).not.toContain("connect");
  });
});
