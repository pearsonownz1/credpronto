export const MCP_TOOL_DOCS = [
  { name: "list_services", description: "Translation and evaluation types, languages, turnaround, and prices." },
  { name: "get_quote", description: "Price and turnaround for a service, page count, language pair, and rush." },
  { name: "submit_document", description: "Upload a file as base64 or https URL. Returns the file id and SHA-256." },
  { name: "create_order", description: "Start an order from uploaded files and charge the account's saved card or invoice." },
  { name: "get_order_status", description: "Order stage and ETA." },
  { name: "list_orders", description: "Orders for this account, optionally filtered by status." },
  { name: "get_preview", description: "Watermarked preview link when the preview is ready." },
  { name: "approve_preview", description: "Accept the watermarked preview. Does not edit the certified PDF." },
  { name: "request_changes", description: "Ask for a change to the preview, with notes." },
  { name: "download_certified", description: "Signed download URL for the final certified PDF once it is ready." },
  { name: "verify_certificate", description: "Verify a certified translation or evaluation by order id or document hash." },
  { name: "register_webhook", description: "Register an https URL for status-change callbacks. The signing secret is shown once." },
] as const;
