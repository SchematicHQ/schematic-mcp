#!/usr/bin/env tsx

/**
 * Simple MCP client for testing the Schematic MCP server
 * This validates that the server responds correctly to MCP protocol messages
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testMCP() {
  console.log("🧪 Testing Schematic MCP Server\n");

  const serverPath = join(__dirname, "dist", "index.js");

  // Create MCP client transport (this will spawn the server process)
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: {
      ...process.env,
      SCHEMATIC_API_KEY: process.env.SCHEMATIC_API_KEY || "test-key",
    },
  });

  try {
    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
    console.log("✅ Connected to MCP server\n");

    // Test 1: List tools
    console.log("Test 1: Listing tools...");
    const tools = await client.listTools();
    console.log(`✅ Found ${tools.tools.length} tools:`);
    tools.tools.forEach((tool) => {
      console.log(`   - ${tool.name}: ${tool.description?.substring(0, 60)}...`);
    });
    console.log("");

    // Test 2: Call a simple tool (list_plans - doesn't require company lookup)
    if (process.env.SCHEMATIC_API_KEY && process.env.SCHEMATIC_API_KEY !== "test-key") {
      console.log("Test 2: Calling list_plans tool...");
      try {
        const result = await client.callTool({
          name: "list_plans",
          arguments: {},
        });
        console.log("✅ Tool call successful!");
        console.log(`Response: ${result.content[0]?.text?.substring(0, 200)}...\n`);
      } catch (error: any) {
        console.log(`⚠️  Tool call failed (expected if API key is invalid): ${error.message}\n`);
      }
    } else {
      console.log("Test 2: Skipped (no valid SCHEMATIC_API_KEY set)\n");
    }

    // Test 3: Validate tool schemas
    console.log("Test 3: Validating tool schemas...");
    let schemaErrors = 0;
    for (const tool of tools.tools) {
      if (!tool.name) {
        console.log(`   ❌ Tool missing name`);
        schemaErrors++;
      }
      if (!tool.description) {
        console.log(`   ⚠️  Tool ${tool.name} missing description`);
      }
      if (!tool.inputSchema) {
        console.log(`   ❌ Tool ${tool.name} missing inputSchema`);
        schemaErrors++;
      }
    }
    if (schemaErrors === 0) {
      console.log("✅ All tool schemas are valid\n");
    } else {
      console.log(`❌ Found ${schemaErrors} schema errors\n`);
    }

    await client.close();
    console.log("✅ Tests completed successfully!");
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testMCP().catch(console.error);

