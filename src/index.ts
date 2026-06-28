#!/usr/bin/env node

/**
 * SchematicHQ MCP Server
 * Provides tools for managing companies, plans, features, and billing
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { setCurrentToolName } from "./client.js";
import { ToolHandler, ToolModule } from "./tools/shared.js";
import { companiesModule } from "./tools/companies.js";
import { plansModule } from "./tools/plans.js";
import { addonsModule } from "./tools/addons.js";
import { featuresModule } from "./tools/features.js";
import { usageModule } from "./tools/usage.js";

const modules: ToolModule[] = [
  companiesModule,
  plansModule,
  addonsModule,
  featuresModule,
  usageModule,
];

const allDefinitions = modules.flatMap((m) => m.definitions);
const allHandlers: Record<string, ToolHandler> = Object.assign(
  {},
  ...modules.map((m) => m.handlers)
);

const server = new Server(
  {
    name: "schematic-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allDefinitions };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  setCurrentToolName(name);

  try {
    const handler = allHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await handler(args);
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Schematic MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
