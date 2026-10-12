import { MOCK_ADMIN_EMAIL, MOCK_CUSTOMER_EMAIL } from "./mock-data";

export type Account = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
};

export function mockAccountName(email: string): string {
  if (email.trim().toLowerCase() === MOCK_CUSTOMER_EMAIL) return "María Ruiz";
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function mockAccountFor(email: string): Account {
  const normalized = email.trim().toLowerCase();
  const admin = normalized === MOCK_ADMIN_EMAIL;
  return {
    id: admin ? "00000000-0000-4000-8000-000000000001" : `mock-${normalized}`,
    email: normalized,
    name: mockAccountName(normalized),
    isAdmin: admin,
  };
}
