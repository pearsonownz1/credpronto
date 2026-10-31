import { MCP_ENDPOINT } from "./catalog";

export function claudeConfig(secret = "cpk_live_…"): string {
  return JSON.stringify(
    {
      mcpServers: {
        credpronto: {
          url: MCP_ENDPOINT,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );
}

export function cursorConfig(secret = "cpk_live_…"): string {
  return JSON.stringify(
    {
      mcpServers: {
        credpronto: {
          url: MCP_ENDPOINT,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );
}

export function openaiAgentsConfig(secret = "cpk_live_…"): string {
  return `import { MCPServerStreamableHttp } from "@openai/agents";

const credpronto = new MCPServerStreamableHttp({
  url: "${MCP_ENDPOINT}",
  requestInit: {
    headers: { Authorization: "Bearer ${secret}" },
  },
});
`;
}

export const MCP_CONFIG_TABS = [
  { id: "claude", label: "Claude", filename: "claude_desktop_config.json" },
  { id: "cursor", label: "Cursor", filename: "mcp.json" },
  { id: "openai", label: "OpenAI Agents SDK", filename: "agent.ts" },
] as const;

export function configFor(tab: (typeof MCP_CONFIG_TABS)[number]["id"], secret?: string): string {
  if (tab === "cursor") return cursorConfig(secret);
  if (tab === "openai") return openaiAgentsConfig(secret);
  return claudeConfig(secret);
}
