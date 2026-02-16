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
import { SchematicClient, Schematic } from "@schematichq/schematic-typescript-node";

type CompanyDetailResponseData = Schematic.CompanyDetailResponseData;
type FeatureDetailResponseData = Schematic.FeatureDetailResponseData;
type CompanyOverrideResponseData = Schematic.CompanyOverrideResponseData;
type CreateCompanyOverrideRequestBody = Schematic.CreateCompanyOverrideRequestBody;
type CreatePlanEntitlementRequestBody = Schematic.CreatePlanEntitlementRequestBody;

import { getApiKey } from "./config.js";
import { resolveCompany, resolveFeature, resolvePlan, fetchAll, getSchematicCompanyUrl, getStripeCustomerUrl } from "./helpers.js";

// Initialize Schematic client lazily
let schematicClient: SchematicClient | null = null;

function getSchematicClient(): SchematicClient {
  if (!schematicClient) {
    const apiKey = getApiKey();
    schematicClient = new SchematicClient({ apiKey });
  }
  return schematicClient;
}

// Create MCP server
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

// Helper to format tool responses
function textResponse(text: string) {
  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

// Helper to check if a string is properly capitalized (Title Case)
function isTitleCase(str: string): boolean {
  if (!str || str.length === 0) return false;
  // Check if first letter is uppercase and rest follows title case rules
  const words = str.split(/\s+/);
  return words.every(word => {
    if (word.length === 0) return true;
    const firstChar = word[0];
    const rest = word.slice(1);
    return firstChar === firstChar.toUpperCase() && rest === rest.toLowerCase();
  });
}

// Helper to convert a string to Title Case
function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map(word => {
      if (word.length === 0) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// Helper to format an override value for display
function formatOverrideValue(override: CompanyOverrideResponseData): string {
  if (override.valueType === "unlimited") return "unlimited";
  if (override.valueBool !== undefined) return override.valueBool ? "on" : "off";
  if (override.valueNumeric !== undefined) return String(override.valueNumeric);
  return "unknown";
}

// Helper to safely extract a string argument from tool args
function stringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== "string") {
    throw new Error(`Expected "${key}" to be a string, got ${typeof val}`);
  }
  return val;
}

// Helper to safely extract a required string argument from tool args
function requiredStringArg(args: Record<string, unknown> | undefined, key: string): string {
  const val = stringArg(args, key);
  if (!val) {
    throw new Error(`"${key}" is required`);
  }
  return val;
}

// Helper to safely extract an array argument from tool args
function arrayArg<T>(args: Record<string, unknown> | undefined, key: string): T[] | undefined {
  const val = args?.[key];
  if (val === undefined || val === null) return undefined;
  if (!Array.isArray(val)) {
    throw new Error(`Expected "${key}" to be an array, got ${typeof val}`);
  }
  return val as T[];
}

// Helper to generate a flag key from a feature name
function generateFlagKey(name: string): string {
  // Convert to lowercase and replace spaces/special chars with underscores
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Company Lookup & Billing Tools
      {
        name: "get_company",
        description:
          "Get company information by ID, name, Stripe customer ID, or custom key. Returns company details including plan, trial status, and links. For custom key lookups, the user must provide both keyName and keyValue. Key names are configured in Schematic - see https://docs.schematichq.com/developer_resources/key_management for details.",
        inputSchema: {
          type: "object",
          properties: {
            companyId: {
              type: "string",
              description: "Schematic company ID (e.g., comp_xxx)",
            },
            companyName: {
              type: "string",
              description: "Company name to search for",
            },
            stripeCustomerId: {
              type: "string",
              description: "Stripe customer ID",
            },
            keyName: {
              type: "string",
              description: "Custom key name to look up the company by (e.g., 'app_id'). Must be used with keyValue. See https://docs.schematichq.com/developer_resources/key_management",
            },
            keyValue: {
              type: "string",
              description: "Custom key value to look up the company by. Must be used with keyName.",
            },
          },
        },
      },
      {
        name: "get_company_plan",
        description: "Get the plan that a company is currently on",
        inputSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            companyName: { type: "string" },
            stripeCustomerId: { type: "string" },
            keyName: { type: "string", description: "Custom key name for company lookup (requires keyValue)" },
            keyValue: { type: "string", description: "Custom key value for company lookup (requires keyName)" },
          },
        },
      },
      {
        name: "get_company_trial_info",
        description: "Check if a company is on a trial and when it ends",
        inputSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            companyName: { type: "string" },
            stripeCustomerId: { type: "string" },
            keyName: { type: "string", description: "Custom key name for company lookup (requires keyValue)" },
            keyValue: { type: "string", description: "Custom key value for company lookup (requires keyName)" },
          },
        },
      },
      {
        name: "count_companies_on_plan",
        description: "Count how many companies are on a specific plan",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "Plan ID (e.g., plan_xxx)" },
            planName: { type: "string", description: "Plan name" },
          },
        },
      },
      {
        name: "link_stripe_to_schematic",
        description:
          "Find the Schematic company for a Stripe customer ID, or vice versa. Returns both IDs and links to both platforms.",
        inputSchema: {
          type: "object",
          properties: {
            stripeCustomerId: {
              type: "string",
              description: "Stripe customer ID",
            },
            companyId: {
              type: "string",
              description: "Schematic company ID",
            },
          },
        },
      },
      // Company Overrides
      {
        name: "list_company_overrides",
        description: "List company overrides. Filter by company (to see all overrides for a company) or by feature (to see which companies have an override for a feature)",
        inputSchema: {
          type: "object",
          properties: {
            companyId: { type: "string", description: "Company ID to filter by" },
            companyName: { type: "string", description: "Company name to filter by" },
            featureName: { type: "string", description: "Feature name to filter by (finds which companies have an override for this feature)" },
            featureId: { type: "string", description: "Feature ID to filter by" },
          },
        },
      },
      {
        name: "set_company_override",
        description: "Set or update a company override for a feature/entitlement. REQUIRES a value parameter - always ask the user for the desired value before calling this tool. For boolean features: use 'on'/'off' or 'true'/'false'. For event-based or trait-based features: use a numeric value (e.g., '10', '100') or 'unlimited'.",
        inputSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            companyName: { type: "string" },
            featureName: { type: "string" },
            featureId: { type: "string" },
            value: {
              type: "string",
              description: "REQUIRED: Override value. For boolean features: 'on'/'off' or 'true'/'false'. For event-based or trait-based features: a numeric value as a string (e.g., '10', '100') or 'unlimited'. Always ask the user for this value if not provided.",
            },
          },
          required: ["value"],
        },
      },
      {
        name: "remove_company_override",
        description: "Remove a company override for a feature/entitlement. This will delete the override and the company will fall back to their plan's entitlements.",
        inputSchema: {
          type: "object",
          properties: {
            companyId: { type: "string" },
            companyName: { type: "string" },
            featureName: { type: "string" },
            featureId: { type: "string" },
          },
        },
      },
      // Plan Management
      {
        name: "list_plans",
        description: "List all plans in your Schematic account",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_plan",
        description: "Create a new plan",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Plan name" },
            description: { type: "string", description: "Plan description" },
          },
          required: ["name"],
        },
      },
      {
        name: "add_entitlements_to_plan",
        description:
          "Add entitlements to a plan. The feature type will be automatically determined by querying the feature. For boolean features, defaults to 'on' if no value is provided. For event-based or trait-based features, a value (number or 'unlimited') is required.",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string" },
            planName: { type: "string" },
            entitlements: {
              type: "array",
              description: "Array of entitlement configurations. For boolean features, value is optional (defaults to 'on'). For event/trait features, value is required.",
              items: {
                type: "object",
                properties: {
                  featureId: { type: "string" },
                  featureName: { type: "string" },
                  value: {
                    type: "string",
                    description: "Optional for boolean features (defaults to 'on'). Required for event/trait features: a number as string (e.g., '10', '100') or 'unlimited'.",
                  },
                },
              },
            },
          },
          required: ["entitlements"],
        },
      },
      {
        name: "get_plan_entitlements",
        description: "Get all features/entitlements included in a plan. Shows what features a plan grants and their values (on/off for boolean, numeric limits for metered, unlimited).",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "Plan ID (e.g., plan_xxx)" },
            planName: { type: "string", description: "Plan name" },
          },
        },
      },
      // Feature Management
      {
        name: "list_features",
        description: "List all features in your Schematic account",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_feature",
        description:
          "Create a new feature flag. Boolean features are simple on/off switches - the most commonly used type, ideal for enabling/disabling functionality and basic plan differentiation. Event-based features are metered against user events and track usage that typically increases over time (e.g., API calls, reports generated, database queries). Trait-based features are based on information reported to Schematic and can track usage that fluctuates up and down (e.g., user seats, projects, devices). Trait-based features must be created in the web app. Optionally entitle the feature to a plan in the same call.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Feature name/key" },
            description: { type: "string", description: "Optional: Feature description" },
            featureType: {
              type: "string",
              enum: ["boolean", "event", "trait"],
              description: "Feature type: 'boolean' (simple on/off switch, most common), 'event' (metered against events that increase over time), or 'trait' (based on information that can fluctuate - must be created in web app). Defaults to 'boolean' if not specified.",
            },
            eventSubtype: {
              type: "string",
              description: "REQUIRED for event-based features: The event subtype to associate with this feature (e.g., 'api_call', 'report_generated').",
            },
            planId: {
              type: "string",
              description: "Optional: Plan ID to entitle this feature to",
            },
            planName: {
              type: "string",
              description: "Optional: Plan name to entitle this feature to",
            },
          },
          required: ["name"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_company": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: stringArg(args, "companyId"),
          companyName: stringArg(args, "companyName"),
          stripeCustomerId: stringArg(args, "stripeCustomerId"),
          keyName: stringArg(args, "keyName"),
          keyValue: stringArg(args, "keyValue"),
        });

        // Helper function to format trial end date (Unix timestamp in seconds)
        const formatTrialEnd = (trialEnd: number | undefined): string => {
          if (!trialEnd) return "Not on trial";
          const trialEndDate = new Date(trialEnd * 1000);
          return `Trial ends: ${trialEndDate.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
          })}`;
        };

        const info = [
          `Company: ${company.name || company.id}`,
          `ID: ${company.id}`,
          company.plan ? `Plan ID: ${company.plan.id}` : "No plan assigned",
          formatTrialEnd(company.billingSubscription?.trialEnd),
          `Schematic: ${getSchematicCompanyUrl(company.id)}`,
        ];

        const stripeKey = company.keys?.find((k) => k.key === "stripe_customer_id");
        if (stripeKey) {
          info.push(
            `Stripe Customer ID: ${stripeKey.value}`,
            `Stripe: ${getStripeCustomerUrl(stripeKey.value)}`
          );
        }

        return textResponse(info.join("\n"));
      }

      case "get_company_plan": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: stringArg(args, "companyId"),
          companyName: stringArg(args, "companyName"),
          stripeCustomerId: stringArg(args, "stripeCustomerId"),
          keyName: stringArg(args, "keyName"),
          keyValue: stringArg(args, "keyValue"),
        });

        if (!company.plan?.id) {
          return textResponse(`Company ${company.name || company.id} is not on any plan.`);
        }

        // Fetch plan details
        const planResponse = await getSchematicClient().plans.getPlan(company.plan.id);
        const plan = planResponse.data;

        return textResponse(
          `Company ${company.name || company.id} is on plan: ${plan.name} (${plan.id})`
        );
      }

      case "get_company_trial_info": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: stringArg(args, "companyId"),
          companyName: stringArg(args, "companyName"),
          stripeCustomerId: stringArg(args, "stripeCustomerId"),
          keyName: stringArg(args, "keyName"),
          keyValue: stringArg(args, "keyValue"),
        });

        const trialEnd = company.billingSubscription?.trialEnd;
        if (!trialEnd) {
          return textResponse(
            `Company ${company.name || company.id} is not on a trial.`
          );
        }

        // Convert trialEnd (Unix timestamp in seconds) to readable date format
        const trialEndDate = new Date(trialEnd * 1000);
        const formattedDate = trialEndDate.toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short'
        });

        return textResponse(
          `Company ${company.name || company.id} is on a trial.\nTrial ends: ${formattedDate}`
        );
      }

      case "count_companies_on_plan": {
        const plan = await resolvePlan(getSchematicClient(), {
          planId: stringArg(args, "planId"),
          planName: stringArg(args, "planName"),
        });

        const count = plan.companyCount || 0;

        return textResponse(
          `${count} compan${count !== 1 ? "ies" : "y"} ${count !== 1 ? "are" : "is"} on plan ${plan.name || plan.id}`
        );
      }

      case "link_stripe_to_schematic": {
        const stripeCustomerId = stringArg(args, "stripeCustomerId");
        const companyId = stringArg(args, "companyId");

        if (stripeCustomerId) {
          const company = await resolveCompany(getSchematicClient(), {
            stripeCustomerId,
          });

          const info = [
            `Stripe Customer ID: ${stripeCustomerId}`,
            `Schematic Company: ${company.name || company.id}`,
            `Schematic Company ID: ${company.id}`,
            `Schematic: ${getSchematicCompanyUrl(company.id)}`,
            `Stripe: ${getStripeCustomerUrl(stripeCustomerId)}`,
          ];

          return textResponse(info.join("\n"));
        } else if (companyId) {
          const company = await resolveCompany(getSchematicClient(), { companyId });

          const stripeKey = company.keys?.find((k) => k.key === "stripe_customer_id");
          if (!stripeKey) {
            return textResponse(
              `Company ${company.name || company.id} is not linked to a Stripe customer.`
            );
          }

          const info = [
            `Schematic Company: ${company.name || company.id}`,
            `Schematic Company ID: ${company.id}`,
            `Stripe Customer ID: ${stripeKey.value}`,
            `Schematic: ${getSchematicCompanyUrl(company.id)}`,
            `Stripe: ${getStripeCustomerUrl(stripeKey.value)}`,
          ];

          return textResponse(info.join("\n"));
        } else {
          throw new Error("Either stripeCustomerId or companyId is required");
        }
      }

      case "list_company_overrides": {
        const companyId = stringArg(args, "companyId");
        const companyName = stringArg(args, "companyName");
        const featureName = stringArg(args, "featureName");
        const featureId = stringArg(args, "featureId");

        // Build filter parameters
        const filterParams: {
          companyId?: string;
          featureId?: string;
          limit?: number;
        } = {
          limit: 100, // Reasonable limit, but companies typically have < 10 overrides
        };

        // Resolve company if filtering by company
        let company: CompanyDetailResponseData | undefined;
        if (companyId || companyName) {
          company = await resolveCompany(getSchematicClient(), {
            companyId,
            companyName,
          });
          filterParams.companyId = company.id;
        }

        // Resolve feature if filtering by feature
        let resolvedFeature: FeatureDetailResponseData | undefined;
        if (featureName || featureId) {
          resolvedFeature = await resolveFeature(getSchematicClient(), { featureId, featureName });
          filterParams.featureId = resolvedFeature.id;
        }

        // Must filter by either company or feature
        if (!filterParams.companyId && !filterParams.featureId) {
          throw new Error("Either companyId/companyName or featureId/featureName is required");
        }

        // Get company overrides
        const overridesResponse = await getSchematicClient().entitlements.listCompanyOverrides(filterParams);
        const overrides = overridesResponse.data || [];

        if (overrides.length === 0) {
          if (company) {
            return textResponse(
              `Company ${company.name || company.id} has no overrides.`
            );
          } else if (resolvedFeature) {
            return textResponse(
              `No companies have an override for feature ${resolvedFeature.name || resolvedFeature.id}.`
            );
          }
          return textResponse("No overrides found.");
        }

        // Format the response
        const results: string[] = [];

        if (company) {
          // Listing all overrides for a company - fetch feature names for display
          const features = await fetchAll(
            (params) => getSchematicClient().features.listFeatures(params),
            {}
          );
          const featureMap = new Map<string, FeatureDetailResponseData>();
          for (const feature of features) {
            featureMap.set(feature.id, feature);
          }

          results.push(`Company ${company.name || company.id} has ${overrides.length} override${overrides.length !== 1 ? "s" : ""}:`);
          for (const override of overrides) {
            const feature = featureMap.get(override.featureId);
            const featureDisplayName = feature?.name || override.featureId;
            results.push(`  - ${featureDisplayName} (${override.featureId}): ${formatOverrideValue(override)}`);
          }
        } else {
          // Listing all companies with override for a feature
          const displayName = resolvedFeature?.name || resolvedFeature?.id;
          results.push(`${overrides.length} compan${overrides.length !== 1 ? "ies have" : "y has"} an override for feature ${displayName}:`);
          for (const override of overrides) {
            const companyName = override.company?.name || override.companyId;
            results.push(`  - ${companyName}: ${formatOverrideValue(override)}`);
          }
        }

        return textResponse(results.join("\n"));
      }

      case "set_company_override": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: stringArg(args, "companyId"),
          companyName: stringArg(args, "companyName"),
        });

        const featureName = stringArg(args, "featureName");
        const featureId = stringArg(args, "featureId");
        const value = stringArg(args, "value");

        if (!value || value.trim() === "") {
          throw new Error("Value is required. Please provide a value: 'on' or 'off' for boolean features, a number for event-based/trait-based features, or 'unlimited' for unlimited quota.");
        }

        const feature = await resolveFeature(getSchematicClient(), { featureId, featureName });
        const featureType = feature.featureType;

        // Determine value type based on feature type and value
        let requestBody: CreateCompanyOverrideRequestBody = {
          companyId: company.id,
          featureId: feature.id,
          valueType: "boolean",
        };

        if (value === "on" || value === "off" || value === "true" || value === "false") {
          requestBody.valueType = "boolean";
          requestBody.valueBool = value === "on" || value === "true";
        } else if (value === "unlimited") {
          requestBody.valueType = "unlimited";
        } else if (!isNaN(Number(value))) {
          if (featureType === "event" || featureType === "trait") {
            requestBody.valueType = "numeric";
            requestBody.valueNumeric = Number(value);
          } else {
            throw new Error(`Cannot set numeric override for feature "${feature.name || feature.id}". Numeric overrides are only supported for event-based or trait-based features. This feature is of type "${featureType}".`);
          }
        } else {
          // Default to boolean true
          requestBody.valueType = "boolean";
          requestBody.valueBool = true;
        }

        // Create or update override
        await getSchematicClient().entitlements.createCompanyOverride(requestBody);

        return textResponse(
          `Set override for company ${company.name || company.id}, feature ${feature.name || feature.id}: ${value}`
        );
      }

      case "remove_company_override": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: stringArg(args, "companyId"),
          companyName: stringArg(args, "companyName"),
        });

        const feature = await resolveFeature(getSchematicClient(), {
          featureId: stringArg(args, "featureId"),
          featureName: stringArg(args, "featureName"),
        });

        // Find the override for this company and feature
        const overridesResponse = await getSchematicClient().entitlements.listCompanyOverrides({
          companyId: company.id,
          featureId: feature.id,
          limit: 1,
        });
        const overrides = overridesResponse.data || [];

        if (overrides.length === 0) {
          return textResponse(
            `No override found for company ${company.name || company.id} on feature ${feature.name || feature.id}.`
          );
        }

        // Delete the override
        await getSchematicClient().entitlements.deleteCompanyOverride(overrides[0].id);

        return textResponse(
          `Removed override for company ${company.name || company.id} on feature ${feature.name || feature.id}.`
        );
      }

      case "get_plan_entitlements": {
        const plan = await resolvePlan(getSchematicClient(), {
          planId: stringArg(args, "planId"),
          planName: stringArg(args, "planName"),
        });

        const entitlements = await fetchAll(
          (params) => getSchematicClient().entitlements.listPlanEntitlements(params),
          { planId: plan.id }
        );

        if (entitlements.length === 0) {
          return textResponse(`Plan ${plan.name || plan.id} has no entitlements.`);
        }

        const results: string[] = [`Plan ${plan.name} (${plan.id}) has ${entitlements.length} entitlement${entitlements.length !== 1 ? "s" : ""}:`];

        for (const entitlement of entitlements) {
          const featureName = entitlement.feature?.name || entitlement.featureId;
          const featureType = entitlement.feature?.featureType || "unknown";
          let valueDisplay: string;

          if (entitlement.valueType === "unlimited") {
            valueDisplay = "unlimited";
          } else if (entitlement.valueBool !== undefined) {
            valueDisplay = entitlement.valueBool ? "on" : "off";
          } else if (entitlement.valueNumeric !== undefined) {
            valueDisplay = String(entitlement.valueNumeric);
          } else {
            valueDisplay = "unknown";
          }

          results.push(`  - ${featureName} (${featureType}): ${valueDisplay}`);
        }

        return textResponse(results.join("\n"));
      }

      case "list_plans": {
        const plans = await fetchAll(
          (params) => getSchematicClient().plans.listPlans(params),
          {}
        );

        if (plans.length === 0) {
          return textResponse("No plans found.");
        }

        const planList = plans
          .map((plan) => `- ${plan.name} (${plan.id})`)
          .join("\n");

        return textResponse(`Plans:\n${planList}`);
      }

      case "create_plan": {
        const name = requiredStringArg(args, "name");
        const description = stringArg(args, "description");

        const planResponse = await getSchematicClient().plans.createPlan({
          name,
          description: description || "",
          planType: "plan",
        });

        const plan = planResponse.data;

        return textResponse(`Created plan: ${plan.name} (${plan.id})`);
      }

      case "add_entitlements_to_plan": {
        const planId = stringArg(args, "planId");
        const planName = stringArg(args, "planName");
        const entitlements = arrayArg<{
          featureId?: string;
          featureName?: string;
          type?: "boolean" | "trait" | "event";
          value?: string;
        }>(args, "entitlements");

        const plan = await resolvePlan(getSchematicClient(), {
          planId,
          planName,
        });

        if (!entitlements || entitlements.length === 0) {
          throw new Error("At least one entitlement is required");
        }

        const results: string[] = [];

        for (const entitlement of entitlements) {
          const feature = await resolveFeature(getSchematicClient(), {
            featureId: entitlement.featureId,
            featureName: entitlement.featureName,
          });
          const featureType = feature.featureType;
          const featureDisplay = feature.name || feature.id;

          // Prepare entitlement request body
          const entitlementBody: CreatePlanEntitlementRequestBody = {
            planId: plan.id,
            featureId: feature.id,
            valueType: "boolean",
          };

          if (featureType === "boolean") {
            const value = entitlement.value || "on";
            entitlementBody.valueType = "boolean";
            entitlementBody.valueBool = value === "on" || value === "true";
          } else if (featureType === "event" || featureType === "trait") {
            if (!entitlement.value) {
              throw new Error(`Value is required for ${featureType}-based feature "${featureDisplay}". Please provide a number (e.g., "10", "100") or "unlimited".`);
            }

            if (entitlement.value === "unlimited") {
              entitlementBody.valueType = "unlimited";
            } else if (!isNaN(Number(entitlement.value))) {
              entitlementBody.valueType = "numeric";
              entitlementBody.valueNumeric = Number(entitlement.value);
            } else {
              throw new Error(`Invalid value "${entitlement.value}" for ${featureType}-based feature "${featureDisplay}". Must be a number or "unlimited".`);
            }
          } else {
            throw new Error(`Unsupported feature type "${featureType}" for feature "${featureDisplay}".`);
          }

          await getSchematicClient().entitlements.createPlanEntitlement(entitlementBody);

          const valueDisplay = entitlement.value || (featureType === "boolean" ? "on" : "not provided");
          results.push(`Added ${featureType} entitlement for feature ${featureDisplay}: ${valueDisplay}`);
        }

        return textResponse(results.join("\n"));
      }

      case "list_features": {
        const features = await fetchAll(
          (params) => getSchematicClient().features.listFeatures(params),
          {}
        );

        if (features.length === 0) {
          return textResponse("No features found.");
        }

        const featureList = features
          .map((feature) => {
            const type = feature.featureType || "unknown";
            return `- ${feature.name} (${feature.id}) - Type: ${type}`;
          })
          .join("\n");

        return textResponse(`Features:\n${featureList}`);
      }

      case "create_feature": {
        const name = requiredStringArg(args, "name");
        const description = stringArg(args, "description");
        const featureTypeArg = stringArg(args, "featureType");
        if (featureTypeArg && !["boolean", "event", "trait"].includes(featureTypeArg)) {
          throw new Error(`Invalid featureType "${featureTypeArg}". Must be "boolean", "event", or "trait".`);
        }
        const featureType = (featureTypeArg as "boolean" | "event" | "trait") || "boolean";
        const eventSubtype = stringArg(args, "eventSubtype");
        const planId = stringArg(args, "planId");
        const planName = stringArg(args, "planName");

        // Check capitalization and auto-correct to Title Case
        const properlyCapitalized = isTitleCase(name);
        const suggestedName = toTitleCase(name);
        const finalName = properlyCapitalized ? name : suggestedName;

        // Use empty string if description is not provided
        const finalDescription = description || "";

        // Trait-based features must be created in the web app
        if (featureType === "trait") {
          return textResponse(
            "Trait-based features must be created in the Schematic web app. Please visit https://app.schematichq.com/features to create trait-based features."
          );
        }

        // Validate event-based feature requirements
        if (featureType === "event" && !eventSubtype) {
          throw new Error("eventSubtype is required for event-based features");
        }

        // Build the create feature request body
        const createFeatureBody: {
          name: string;
          description: string;
          featureType: "boolean" | "event";
          eventSubtype?: string;
        } = {
          name: finalName,
          description: finalDescription,
          featureType,
        };

        if (featureType === "event" && eventSubtype) {
          createFeatureBody.eventSubtype = eventSubtype;
        }

        const featureResponse = await getSchematicClient().features.createFeature(createFeatureBody);

        const feature = featureResponse.data;
        let result = `Created feature: ${feature.name} (${feature.id})`;

        // Create a flag for the feature
        try {
          const flagKey = generateFlagKey(feature.name);
          const flagResponse = await getSchematicClient().features.createFlag({
            key: flagKey,
            name: feature.name,
            description: finalDescription || `Flag for ${feature.name}`,
            flagType: "boolean",
            defaultValue: false,
            featureId: feature.id,
          });

          const flag = flagResponse.data;
          result += `\nCreated flag: ${flag.name} (key: ${flag.key})`;
        } catch (flagError: unknown) {
          const flagErrorMessage = flagError instanceof Error ? flagError.message : "Unknown error";
          result += `\n⚠️  Warning: Feature created but flag creation failed: ${flagErrorMessage}`;
        }

        // Add capitalization suggestion if the name was changed
        if (!properlyCapitalized && name !== finalName) {
          result += `\n💡 Note: Feature name was capitalized from "${name}" to "${finalName}"`;
        }

        return textResponse(result);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    throw new McpError(
      ErrorCode.InternalError,
      errorMessage
    );
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Schematic MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

