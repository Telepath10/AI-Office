export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Calls DataForSEO; returns the raw response JSON and the endpoint used (for the ledger). */
  run: (args: any) => Promise<{ endpoint: string; data: any }>;
  /** Local/free tools: skip spend ledger and DataForSEO envelope shaping. */
  local?: boolean;
}
