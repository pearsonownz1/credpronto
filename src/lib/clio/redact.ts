/** Drop credentials and signed URLs before anything is logged. */
export function safeClioMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Clio request failed";
  return message
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/access_token[=:]\s*\S+/gi, "access_token=[redacted]")
    .replace(/refresh_token[=:]\s*\S+/gi, "refresh_token=[redacted]")
    .replace(/client_secret[=:]\s*\S+/gi, "client_secret=[redacted]")
    .replace(/client_id[=:]\s*\S+/gi, "client_id=[redacted]")
    .replace(/custom_action_nonce[=:]\s*\S+/gi, "custom_action_nonce=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
