import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mockEvaluationSources } from "@/lib/account/mock-data";
import { EvaluationQueue } from "@/components/admin/evaluation-queue";
import { parseEvaluationQueue } from "@/lib/api/parse";
import { evaluationQueueRows } from "./evaluation-queue";

const NOW = Date.parse("2026-10-12T20:00:00.000Z");

describe("evaluation queue", () => {
  it("keeps paid diploma and course-by-course orders, oldest paid first", () => {
    const rows = evaluationQueueRows(mockEvaluationSources(NOW), NOW);
    expect(rows.map((row) => row.id)).toEqual(["CP-24920", "CP-24921"]);
    expect(rows.map((row) => row.type)).toEqual(["diploma", "course_by_course"]);
    expect(rows.map((row) => row.waitMinutes)).toEqual([3, 1]);
    expect(rows.map((row) => row.customerEmail)).toEqual(["ada@example.com", "marie@example.com"]);
  });

  it("drops translations and orders with no payment time", () => {
    const rows = evaluationQueueRows(
      [
        { id: "translation", service: null, email: "a@example.com", paidAt: "2026-10-12T12:00:00.000Z" },
        { id: "unpaid", service: "diploma", email: "b@example.com", paidAt: null },
        { id: "newer", service: "course_by_course", email: "c@example.com", paidAt: "2026-10-12T12:20:00.000Z" },
        { id: "older", service: "diploma", email: "d@example.com", paidAt: "2026-10-12T12:00:00.000Z" },
      ],
      NOW,
    );
    expect(rows.map((row) => row.id)).toEqual(["older", "newer"]);
  });

  it("reads the evaluation queue payload", () => {
    const parsed = parseEvaluationQueue({
      orders: [
        {
          id: "ord_1",
          type: "diploma",
          customerEmail: "ada@example.com",
          paidAt: "2026-10-12T12:00:00.000Z",
          waitMinutes: 3,
        },
      ],
      page: { limit: 100, offset: 0, total: 1 },
    });
    expect(parsed?.orders[0]).toMatchObject({ id: "ord_1", type: "diploma", waitMinutes: 3 });
    expect(parseEvaluationQueue({ orders: [{ id: "ord_1", type: "translation" }] })).toBeNull();
  });
});

describe("evaluation queue screen", () => {
  it("shows waiting time and turns the badge red after 2 minutes", () => {
    const html = renderToStaticMarkup(
      createElement(EvaluationQueue, {
        orders: evaluationQueueRows(mockEvaluationSources(NOW), NOW),
        now: NOW,
      }),
    );
    expect(html).toContain("Paid evaluations waiting for a finished report, oldest first.");
    expect(html).not.toContain("No paid evaluations are waiting.");
    expect(html.indexOf("CP-24920")).toBeLessThan(html.indexOf("CP-24921"));
    expect(html).toContain("Waiting 3 min");
    expect(html).toContain("Waiting 1 min");
    expect(html).toContain('data-testid="waiting-badge"');
    expect(html).toContain('data-late="true"');
    expect(html).toContain('data-late="false"');
    expect(html).not.toContain("CP-24922");
    expect(html).not.toContain("CP-24790");
    const empty = renderToStaticMarkup(createElement(EvaluationQueue, { orders: [] }));
    expect(empty).toContain("No paid evaluations are waiting.");
  });
});
