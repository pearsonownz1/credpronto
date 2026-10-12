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
    for (const file of files) {
      if (file === "20261012060000_staff_notified_event.sql") continue;
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      expect(sql.includes("staff_notified")).toBe(false);
    }
  });
});
