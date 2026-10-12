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
});
