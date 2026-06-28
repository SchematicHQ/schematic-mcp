import { SchematicClient } from "@schematichq/schematic-typescript-node";
import { getApiKey } from "./config.js";
import { version as mcpVersion } from "./version.js";

let schematicClient: SchematicClient | null = null;
let currentToolName = "unknown";

export function setCurrentToolName(name: string): void {
  currentToolName = name;
}

export function getSchematicClient(): SchematicClient {
  if (!schematicClient) {
    const apiKey = getApiKey();
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, "User-Agent", {
      get: () => `schematic-mcp/${mcpVersion} tool/${currentToolName}`,
      enumerable: true,
    });
    schematicClient = new SchematicClient({ apiKey, headers });
  }
  return schematicClient;
}
