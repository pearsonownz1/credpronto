import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const addedEvents = ["account_linked", "translation_edited", "note_added", "approved"];
const exclusiveEvents = ["account_linked", "translation_edited", "note_added"];

describe("auth migrations", () => {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

  it("keeps new enum values in their own migration", () => {
    const enumFile = files.find((file) => file.endsWith("_order_event_types.sql"));
    expect(enumFile).toBeTruthy();
    const sql = readFileSync(path.join(migrationsDir, enumFile as string), "utf8");
    for (const event of addedEvents) {
      const lines = sql
        .split("\n")
        .filter((line) => line.includes(event))
        .map((line) => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.startsWith("--") || line.includes("add value")).toBe(true);
      }
    }

    for (const file of files) {
      if (file === enumFile) continue;
      const other = readFileSync(path.join(migrationsDir, file), "utf8");
      for (const event of exclusiveEvents) {
        expect(other.includes(event)).toBe(false);
      }
    }
  });

  it("defines profiles.is_admin and orders.user_id in separate files", () => {
    const profiles = readFileSync(path.join(migrationsDir, "20261012050000_profiles.sql"), "utf8");
    const orders = readFileSync(path.join(migrationsDir, "20261012050100_orders_user_id.sql"), "utf8");
    const notes = readFileSync(path.join(migrationsDir, "20261012050200_order_notes.sql"), "utf8");
    expect(profiles).toMatch(/is_admin boolean not null default false/);
    expect(profiles).toMatch(/profiles\.is_admin/);
    expect(profiles).toMatch(/on_auth_user_created/);
    expect(orders).toMatch(/user_id uuid references auth\.users/);
    expect(orders).toMatch(/customer_select_own_orders/);
    expect(orders).toMatch(/customer_select_own_documents/);
    expect(orders).toMatch(/customer_select_own_previews/);
    expect(orders).toMatch(/customer_select_own_payments/);
    expect(notes).toMatch(/create table public\.order_notes/);
  });

  it("keeps staff_notified and the QA status enum out of the table that uses them", () => {
    const notified = readFileSync(path.join(migrationsDir, "20261012060000_staff_notified_event.sql"), "utf8");
    const status = readFileSync(path.join(migrationsDir, "20261012060100_qa_status.sql"), "utf8");
    const runs = readFileSync(path.join(migrationsDir, "20261012060200_order_qa_runs.sql"), "utf8");
    expect(notified).toMatch(/add value if not exists 'staff_notified'/);
    expect(notified.toLowerCase()).not.toMatch(/insert into/);
    expect(status).toMatch(/create type public\.qa_status/);
    expect(status).not.toMatch(/order_qa_runs/);
    expect(runs).toMatch(/create table public\.order_qa_runs/);
    expect(runs.toLowerCase()).not.toMatch(/add value/);
    expect(runs.toLowerCase()).not.toMatch(/create type/);
    const apiKeys = readFileSync(path.join(migrationsDir, "20261012070000_api_keys.sql"), "utf8");
    const endpoints = readFileSync(path.join(migrationsDir, "20261012070100_webhook_endpoints.sql"), "utf8");
    const deliveries = readFileSync(path.join(migrationsDir, "20261012070200_webhook_deliveries.sql"), "utf8");
    const externalRef = readFileSync(path.join(migrationsDir, "20261012070300_orders_external_ref.sql"), "utf8");
    const billing = readFileSync(path.join(migrationsDir, "20261012070400_billing_customers.sql"), "utf8");
    expect(apiKeys).toMatch(/create table public\.api_keys/);
    expect(endpoints).toMatch(/create table public\.webhook_endpoints/);
    expect(deliveries).toMatch(/create table public\.webhook_deliveries/);
    expect(externalRef).toMatch(/external_ref text/);
    expect(billing).toMatch(/create table public\.billing_customers/);
    const edge = readFileSync(path.join(migrationsDir, "20261012090000_edge_reference.sql"), "utf8");
    expect(edge).toMatch(/create table public\.edge_credentials/);
    expect(edge).toMatch(/create table public\.edge_grading_scales/);
    expect(edge).toMatch(/on public\.edge_credentials \(country_slug, lower\(title\)\)/);
    expect(edge).toMatch(/us_equivalency text/);
    expect(edge).toMatch(/rows jsonb not null/);
    expect(edge).toMatch(/enable row level security/);
    expect(edge.toLowerCase()).not.toMatch(/create policy/);
    expect(edge.toLowerCase()).not.toMatch(/grant [^;]*to (anon|authenticated)/);
    expect(edge).toMatch(/to service_role/);
    expect(edge.toLowerCase()).not.toMatch(/insert into/);
    expect(edge).toMatch(/edge_credential_id uuid/);
    expect(edge).toMatch(/edge_grading_scale_id uuid/);
    const equivalencies = readFileSync(path.join(migrationsDir, "20261012130000_edge_equivalencies.sql"), "utf8");
    expect(equivalencies).toMatch(/create table public\.edge_equivalencies/);
    expect(equivalencies).toMatch(/edge_credential_id uuid not null references public\.edge_credentials/);
    expect(equivalencies).toMatch(/credential_title text not null/);
    expect(equivalencies).toMatch(/edge_level text/);
    expect(equivalencies).toMatch(/us_equivalency text not null/);
    expect(equivalencies).toMatch(/basis text not null/);
    expect(equivalencies).toMatch(/confidence in \('high', 'medium', 'low'\)/);
    expect(equivalencies).toMatch(/enable row level security/);
    expect(equivalencies.toLowerCase()).not.toMatch(/create policy/);
    expect(equivalencies.toLowerCase()).not.toMatch(/grant [^;]*to (anon|authenticated)/);
    expect(equivalencies).toMatch(/to service_role/);
    expect(equivalencies.toLowerCase()).not.toMatch(/insert into/);
    const matchMethod = readFileSync(path.join(migrationsDir, "20261012160000_edge_match_method.sql"), "utf8");
    expect(matchMethod).toMatch(/add column edge_match_method text/);
    expect(matchMethod).toMatch(/edge_match_method in \('base', 'fuzzy'\)/);
    expect(matchMethod.toLowerCase()).not.toMatch(/insert into/);
    expect(matchMethod.toLowerCase()).not.toMatch(/create policy/);
    const lastUsed = readFileSync(path.join(migrationsDir, "20261012100000_api_keys_last_used_at.sql"), "utf8");
    expect(lastUsed).toMatch(/add column last_used_at timestamptz/);
    expect(lastUsed.toLowerCase()).not.toMatch(/create table/);
    const lifecycle = readFileSync(path.join(migrationsDir, "20261012100100_webhook_delivery_events.sql"), "utf8");
    expect(lifecycle).toMatch(/order\.preview_ready/);
    expect(lifecycle).toMatch(/order\.paid/);
    expect(lifecycle).toMatch(/order\.completed/);
    expect(lifecycle).toMatch(/webhook\.test/);
    const evaluationPaid = readFileSync(
      path.join(migrationsDir, "20261013100000_evaluation_paid_webhook.sql"),
      "utf8",
    );
    expect(evaluationPaid).toMatch(/evaluation\.paid/);
    expect(evaluationPaid).toMatch(/drop constraint webhook_deliveries_event_chk/);
    expect(evaluationPaid).toMatch(/add constraint webhook_deliveries_event_chk/);
    expect(evaluationPaid.toLowerCase()).not.toMatch(/create table/);
    expect(evaluationPaid.toLowerCase()).not.toMatch(/add column/);
    expect(lifecycle).toMatch(/alter column order_id drop not null/);
    expect(lifecycle.toLowerCase()).not.toMatch(/create table/);
    expect(lifecycle.toLowerCase()).not.toMatch(/add column/);
    const apiOrders = readFileSync(path.join(migrationsDir, "20261012100200_orders_api_key_id.sql"), "utf8");
    expect(apiOrders).toMatch(/add column api_key_id uuid references public\.api_keys/);
    expect(apiOrders).toMatch(/on delete set null/);
    expect(apiOrders.toLowerCase()).not.toMatch(/create table/);
    expect(billing).toMatch(/stripe_customer_id text not null/);
    expect(billing).not.toMatch(/card_number/);
    for (const sql of [apiKeys, endpoints, deliveries, externalRef, billing]) {
      expect(sql.toLowerCase()).not.toMatch(/create type/);
      expect(sql.toLowerCase()).not.toMatch(/add value/);
    }
    for (const file of files) {
      if (file === "20261012060000_staff_notified_event.sql") continue;
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      expect(sql.includes("staff_notified")).toBe(false);
    }
  });

  it("stores evaluation translation as an opt-in flag", () => {
    const sql = readFileSync(
      path.join(migrationsDir, "20261012150000_evaluation_translation_opt_in.sql"),
      "utf8",
    );
    expect(sql).toMatch(/add column include_translation boolean not null default false/);
    expect(sql).toMatch(/set include_translation = true/);
    expect(sql).toMatch(/where coalesce\(translation_cents, 0\) > 0/);
    expect(sql).toMatch(/translation_cents = 0/);
    expect(sql).toMatch(/include_translation = true/);
    expect(sql).toMatch(/translation_cents = billable_pages \* unit_price_cents/);
    expect(sql.toLowerCase()).not.toMatch(/create type/);
    expect(sql.toLowerCase()).not.toMatch(/add value/);
  });
});
