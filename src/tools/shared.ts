import { Schematic } from "@schematichq/schematic-typescript-node";

type CompanyOverrideResponseData = Schematic.CompanyOverrideResponseData;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
};

export type ToolHandler = (
  args: Record<string, unknown> | undefined
) => Promise<ToolResponse>;

export interface ToolModule {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

export function textResponse(text: string): ToolResponse {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

export function jsonResponse(data: unknown): ToolResponse {
  return textResponse(JSON.stringify(data, null, 2));
}

export function formatOverrideValue(override: CompanyOverrideResponseData): string {
  if (override.valueType === "unlimited") return "unlimited";
  if (override.valueBool !== undefined) return override.valueBool ? "on" : "off";
  if (override.valueNumeric !== undefined) return String(override.valueNumeric);
  return "unknown";
}

export function formatEntitlementValue(value: {
  valueType?: string;
  valueBool?: boolean;
  valueNumeric?: number;
}): string {
  switch (value.valueType) {
    case "unlimited":
      return "unlimited";
    case "boolean":
      return value.valueBool ? "on" : "off";
    case "numeric":
      return value.valueNumeric !== undefined ? String(value.valueNumeric) : "(numeric, no value)";
    case "trait":
      return "trait-based";
    default:
      return `(${value.valueType ?? "unknown type"})`;
  }
}

export function stringArg(
  args: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") {
    throw new Error(`Expected "${key}" to be a string, got ${typeof val}`);
  }
  return val;
}

export function requiredStringArg(
  args: Record<string, unknown> | undefined,
  key: string
): string {
  const val = stringArg(args, key);
  if (!val) {
    throw new Error(`"${key}" is required`);
  }
  return val;
}

export function arrayArg<T>(
  args: Record<string, unknown> | undefined,
  key: string
): T[] | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (!Array.isArray(val)) {
    throw new Error(`Expected "${key}" to be an array, got ${typeof val}`);
  }
  return val as T[];
}

export function booleanArg(
  args: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "boolean") {
    throw new Error(`Expected "${key}" to be a boolean, got ${typeof val}`);
  }
  return val;
}

export function generateFlagKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
