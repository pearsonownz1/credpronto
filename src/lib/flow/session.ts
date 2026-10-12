export const TOKEN_KEY = "credpronto-order-token";
export const EMAIL_KEY = "credpronto-order-email";
export const ORDER_EVENT = "credpronto-order";

export const MOCK_TOKEN = "mock-token";

export function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function writeToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(ORDER_EVENT));
}

export function readEmail(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(EMAIL_KEY) ?? "";
}

export function writeEmail(email: string) {
  sessionStorage.setItem(EMAIL_KEY, email);
  window.dispatchEvent(new Event(ORDER_EVENT));
}
