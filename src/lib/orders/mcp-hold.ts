/** Draft bucket for files uploaded before `create_order`. Not a customer order. */
export const MCP_HOLD_REF = "mcp-hold";

export function isMcpHold(externalRef: string | null | undefined): boolean {
  return externalRef === MCP_HOLD_REF;
}
