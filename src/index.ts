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

type PlanDetailResponseData = Schematic.PlanDetailResponseData;
type CompanyDetailResponseData = Schematic.CompanyDetailResponseData;
type FeatureDetailResponseData = Schematic.FeatureDetailResponseData;
type CompanyOverrideResponseData = Schematic.CompanyOverrideResponseData;
type CreateCompanyOverrideRequestBody = Schematic.CreateCompanyOverrideRequestBody;
type CreatePlanEntitlementRequestBody = Schematic.CreatePlanEntitlementRequestBody;

import { z } from "zod";
import { getApiKey } from "./config.js";
import { resolveCompany, getSchematicCompanyUrl, getStripeCustomerUrl } from "./helpers.js";

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

// Helper to format error responses
function errorResponse(message: string, code?: ErrorCode): never {
  throw new McpError(code || ErrorCode.InternalError, message);
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
          "Get company information by ID, name, Stripe customer ID, or internal app ID. Returns company details including plan, trial status, and links.",
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
            internalAppId: {
              type: "string",
              description: "Internal application ID (will search company keys)",
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
            internalAppId: { type: "string" },
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
            internalAppId: { type: "string" },
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
          companyId: args?.companyId as string,
          companyName: args?.companyName as string,
          stripeCustomerId: args?.stripeCustomerId as string,
          internalAppId: args?.internalAppId as string,
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
          companyId: args?.companyId as string,
          companyName: args?.companyName as string,
          stripeCustomerId: args?.stripeCustomerId as string,
          internalAppId: args?.internalAppId as string,
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
          companyId: args?.companyId as string,
          companyName: args?.companyName as string,
          stripeCustomerId: args?.stripeCustomerId as string,
          internalAppId: args?.internalAppId as string,
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
        const planId = args?.planId as string;
        const planName = args?.planName as string;

        let plan: PlanDetailResponseData;

        if (planName && !planId) {
          // Find plan by name
          const plansResponse = await getSchematicClient().plans.listPlans({});
          const plans = plansResponse.data || [];
          const foundPlan = plans.find((p) => p.name === planName);
          if (!foundPlan) {
            throw new Error(`Plan "${planName}" not found`);
          }
          plan = foundPlan;
        } else if (planId) {
          // Get plan by ID
          const planResponse = await getSchematicClient().plans.getPlan(planId);
          plan = planResponse.data;
        } else {
          throw new Error("Either planId or planName is required");
        }

        const count = plan.companyCount || 0;

        return textResponse(
          `${count} compan${count !== 1 ? "ies" : "y"} ${count !== 1 ? "are" : "is"} on plan ${planName || plan.name || planId}`
        );
      }

      case "link_stripe_to_schematic": {
        const stripeCustomerId = args?.stripeCustomerId as string;
        const companyId = args?.companyId as string;

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
        const companyId = args?.companyId as string;
        const companyName = args?.companyName as string;
        const featureName = args?.featureName as string;
        const featureId = args?.featureId as string;

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
        let targetFeatureId = featureId;
        if (featureName && !featureId) {
          const featuresResponse = await getSchematicClient().features.listFeatures({});
          const features = featuresResponse.data || [];
          const feature = features.find((f) => f.name === featureName || f.flags?.[0]?.key === featureName);
          if (!feature) {
            throw new Error(`Feature "${featureName}" not found`);
          }
          targetFeatureId = feature.id;
        }

        if (targetFeatureId) {
          filterParams.featureId = targetFeatureId;
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
          } else if (targetFeatureId) {
            return textResponse(
              `No companies have an override for feature ${featureName || targetFeatureId}.`
            );
          }
          return textResponse("No overrides found.");
        }

        // Fetch all features to get names (create a map for quick lookup)
        const featuresResponse = await getSchematicClient().features.listFeatures({});
        const features = featuresResponse.data || [];
        const featureMap = new Map<string, FeatureDetailResponseData>();
        for (const feature of features) {
          featureMap.set(feature.id, feature);
        }

        // Get the feature name if filtering by feature
        let targetFeatureName: string | undefined;
        if (targetFeatureId) {
          const targetFeature = featureMap.get(targetFeatureId);
          targetFeatureName = targetFeature?.name || featureName;
        }

        // Format the response
        const results: string[] = [];

        if (company) {
          // Listing all overrides for a company
          results.push(`Company ${company.name || company.id} has ${overrides.length} override${overrides.length !== 1 ? "s" : ""}:`);
          for (const override of overrides) {
            let overrideValue: string;
            if (override.valueType === "unlimited") {
              overrideValue = "unlimited";
            } else if (override.valueBool !== undefined) {
              overrideValue = override.valueBool ? "on" : "off";
            } else if (override.valueNumeric !== undefined) {
              overrideValue = String(override.valueNumeric);
            } else {
              overrideValue = "unknown";
            }
            const feature = featureMap.get(override.featureId);
            const featureDisplayName = feature?.name || override.featureId;
            results.push(`  - ${featureDisplayName} (${override.featureId}): ${overrideValue}`);
          }
        } else {
          // Listing all companies with override for a feature
          results.push(`${overrides.length} compan${overrides.length !== 1 ? "ies have" : "y has"} an override for feature ${targetFeatureName || targetFeatureId}:`);
          for (const override of overrides) {
            let overrideValue: string;
            if (override.valueType === "unlimited") {
              overrideValue = "unlimited";
            } else if (override.valueBool !== undefined) {
              overrideValue = override.valueBool ? "on" : "off";
            } else if (override.valueNumeric !== undefined) {
              overrideValue = String(override.valueNumeric);
            } else {
              overrideValue = "unknown";
            }
            const companyName = override.company?.name || override.companyId;
            results.push(`  - ${companyName}: ${overrideValue}`);
          }
        }

        return textResponse(results.join("\n"));
      }

      case "set_company_override": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: args?.companyId as string,
          companyName: args?.companyName as string,
        });

        const featureName = args?.featureName as string;
        const featureId = args?.featureId as string;
        const value = args?.value as string;

        if (!value || value.trim() === "") {
          throw new Error("Value is required. Please provide a value: 'on' or 'off' for boolean features, a number for event-based/trait-based features, or 'unlimited' for unlimited quota.");
        }

        let targetFeatureId = featureId;

        if (featureName && !featureId) {
          // Find feature by name
          const featuresResponse = await getSchematicClient().features.listFeatures({});
          const features = featuresResponse.data || [];
          const feature = features.find((f) => f.name === featureName || f.flags?.[0]?.key === featureName);
          if (!feature) {
            throw new Error(`Feature "${featureName}" not found`);
          }
          targetFeatureId = feature.id;
        }

        if (!targetFeatureId) {
          throw new Error("Either featureId or featureName is required");
        }

        // Get feature details to determine type
        const featureResponse = await getSchematicClient().features.getFeature(targetFeatureId);
        const feature = featureResponse.data;
        const featureType = feature.featureType;

        // Determine value type based on feature type and value
        let requestBody: CreateCompanyOverrideRequestBody = {
          companyId: company.id,
          featureId: targetFeatureId,
          valueType: "boolean",
        };
        
        if (value === "on" || value === "off" || value === "true" || value === "false") {
          requestBody.valueType = "boolean";
          requestBody.valueBool = value === "on" || value === "true";
        } else if (value === "unlimited") {
          requestBody.valueType = "unlimited";
        } else if (!isNaN(Number(value))) {
          // For numeric values, support both event-based and trait-based features
          // Both use "numeric" as valueType (not "trait" override type)
          if (featureType === "event" || featureType === "trait") {
            requestBody.valueType = "numeric";
            requestBody.valueNumeric = Number(value);
          } else {
            throw new Error(`Cannot set numeric override for feature "${featureName || targetFeatureId}". Numeric overrides are only supported for event-based or trait-based features. This feature is of type "${featureType}".`);
          }
        } else {
          // Default to boolean true
          requestBody.valueType = "boolean";
          requestBody.valueBool = true;
        }

        // Create or update override
        await getSchematicClient().entitlements.createCompanyOverride(requestBody);

        return textResponse(
          `Set override for company ${company.name || company.id}, feature ${featureName || targetFeatureId}: ${value}`
        );
      }

      case "remove_company_override": {
        const company = await resolveCompany(getSchematicClient(), {
          companyId: args?.companyId as string,
          companyName: args?.companyName as string,
        });

        const featureName = args?.featureName as string;
        const featureId = args?.featureId as string;

        let targetFeatureId = featureId;

        if (featureName && !featureId) {
          // Find feature by name
          const featuresResponse = await getSchematicClient().features.listFeatures({});
          const features = featuresResponse.data || [];
          const feature = features.find((f) => f.name === featureName || f.flags?.[0]?.key === featureName);
          if (!feature) {
            throw new Error(`Feature "${featureName}" not found`);
          }
          targetFeatureId = feature.id;
        }

        if (!targetFeatureId) {
          throw new Error("Either featureId or featureName is required");
        }

        // Find the override for this company and feature
        const overridesResponse = await getSchematicClient().entitlements.listCompanyOverrides({
          companyId: company.id,
          featureId: targetFeatureId,
          limit: 1,
        });
        const overrides = overridesResponse.data || [];

        if (overrides.length === 0) {
          return textResponse(
            `No override found for company ${company.name || company.id} on feature ${featureName || targetFeatureId}.`
          );
        }

        const override = overrides[0];
        const overrideId = override.id;

        // Delete the override
        await getSchematicClient().entitlements.deleteCompanyOverride(overrideId);

        return textResponse(
          `Removed override for company ${company.name || company.id} on feature ${featureName || targetFeatureId}.`
        );
      }

      case "list_plans": {
        const plansResponse = await getSchematicClient().plans.listPlans({});
        const plans = plansResponse.data || [];

        if (plans.length === 0) {
          return textResponse("No plans found.");
        }

        const planList = plans
          .map((plan) => `- ${plan.name} (${plan.id})`)
          .join("\n");

        return textResponse(`Plans:\n${planList}`);
      }

      case "create_plan": {
        const name = args?.name as string;
        const description = args?.description as string;

        if (!name) {
          throw new Error("Plan name is required");
        }

        const planResponse = await getSchematicClient().plans.createPlan({
          name,
          description,
          planType: "plan",
        });

        const plan = planResponse.data;

        return textResponse(`Created plan: ${plan.name} (${plan.id})`);
      }

      case "add_entitlements_to_plan": {
        const planId = args?.planId as string;
        const planName = args?.planName as string;
        const entitlements = args?.entitlements as Array<{
          featureId?: string;
          featureName?: string;
          type?: "boolean" | "trait" | "event";
          value?: string;
        }>;

        let targetPlanId = planId;

        if (planName && !planId) {
          // Find plan by name
          const plansResponse = await getSchematicClient().plans.listPlans({});
          const plans = plansResponse.data || [];
          const plan = plans.find((p) => p.name === planName);
          if (!plan) {
            throw new Error(`Plan "${planName}" not found`);
          }
          targetPlanId = plan.id;
        }

        if (!targetPlanId) {
          throw new Error("Either planId or planName is required");
        }

        if (!entitlements || entitlements.length === 0) {
          throw new Error("At least one entitlement is required");
        }

        const results: string[] = [];

        for (const entitlement of entitlements) {
          const featureName = entitlement.featureName;
          const featureId = entitlement.featureId;
          let targetFeatureId = featureId;

          if (featureName && !featureId) {
            // Find feature by name
            const featuresResponse = await getSchematicClient().features.listFeatures({});
            const features = featuresResponse.data || [];
            const feature = features.find(
              (f) => f.name === featureName || f.flags?.[0]?.key === featureName
            );
            if (!feature) {
              throw new Error(`Feature "${featureName}" not found`);
            }
            targetFeatureId = feature.id;
          }

          if (!targetFeatureId) {
            throw new Error("Either featureId or featureName is required for each entitlement");
          }

          // Get feature details to determine type
          const featureResponse = await getSchematicClient().features.getFeature(targetFeatureId);
          const feature = featureResponse.data;
          const featureType = feature.featureType;

          // Prepare entitlement request body
          const entitlementBody: CreatePlanEntitlementRequestBody = {
            planId: targetPlanId,
            featureId: targetFeatureId,
            valueType: "boolean",
          };

          if (featureType === "boolean") {
            // For boolean features, default to "on" (true) if no value provided
            const value = entitlement.value || "on";
            entitlementBody.valueType = "boolean";
            entitlementBody.valueBool = value === "on" || value === "true";
          } else if (featureType === "event" || featureType === "trait") {
            // For event/trait features, value is required
            if (!entitlement.value) {
              throw new Error(`Value is required for ${featureType}-based feature "${featureName || targetFeatureId}". Please provide a number (e.g., "10", "100") or "unlimited".`);
            }

            if (entitlement.value === "unlimited") {
              entitlementBody.valueType = "unlimited";
            } else if (!isNaN(Number(entitlement.value))) {
              // Both event and trait features use "numeric" for numeric values
              entitlementBody.valueType = "numeric";
              entitlementBody.valueNumeric = Number(entitlement.value);
            } else {
              throw new Error(`Invalid value "${entitlement.value}" for ${featureType}-based feature "${featureName || targetFeatureId}". Must be a number or "unlimited".`);
            }
          } else {
            throw new Error(`Unsupported feature type "${featureType}" for feature "${featureName || targetFeatureId}".`);
          }

          // Create plan entitlement
          await getSchematicClient().entitlements.createPlanEntitlement(entitlementBody);

          const valueDisplay = entitlement.value || (featureType === "boolean" ? "on" : "not provided");
          results.push(`Added ${featureType} entitlement for feature ${featureName || targetFeatureId}: ${valueDisplay}`);
        }

        return textResponse(results.join("\n"));
      }

      case "list_features": {
        const featuresResponse = await getSchematicClient().features.listFeatures({});
        const features = featuresResponse.data || [];

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
        const name = args?.name as string;
        const description = args?.description as string;
        const featureType = (args?.featureType as "boolean" | "event" | "trait") || "boolean";
        const eventSubtype = args?.eventSubtype as string;
        const planId = args?.planId as string;
        const planName = args?.planName as string;

        if (!name) {
          throw new Error("Feature name is required");
        }

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
        // Note: The SDK may use 'eventName' but the API expects 'EventSubtype'
        const createFeatureBody: {
          name: string;
          description: string;
          featureType: "boolean" | "event";
          eventName?: string;
          eventSubtype?: string;
        } = {
          name: finalName,
          description: finalDescription,
          featureType,
        };

        if (featureType === "event" && eventSubtype) {
          // Try both field names - SDK might use eventName, API expects EventSubtype
          createFeatureBody.eventName = eventSubtype;
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

