/** Empty and malformed addresses. A dotted domain is required. */
export function customerEmailError(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email.";
  return null;
}
