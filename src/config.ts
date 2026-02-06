/**
 * Configuration management for Schematic MCP Server
 * Supports environment variables (primary) and config file (fallback)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function getApiKey(): string {
  // Try environment variable first (most common for MCP)
  const envKey = process.env.SCHEMATIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  // Fallback to config file
  try {
    const configPath = join(homedir(), ".schematic-mcp", "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.apiKey) {
      return config.apiKey;
    }
  } catch (error) {
    // Config file doesn't exist or is invalid, that's okay
  }

  throw new Error(
    "SCHEMATIC_API_KEY environment variable or config file (~/.schematic-mcp/config.json) is required"
  );
}

