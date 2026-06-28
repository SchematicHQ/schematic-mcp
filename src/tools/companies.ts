import { Schematic } from "@schematichq/schematic-typescript-node";
import {
  resolveCompany,
  resolveFeature,
  resolvePlan,
  fetchAll,
  getSchematicCompanyUrl,
  getSchematicCompanyEntitlementsUrl,
  getStripeCustomerUrl,
} from "../helpers.js";
import { getSchematicClient } from "../client.js";
import {
  ToolModule,
  formatOverrideValue,
  jsonResponse,
  stringArg,
  textResponse,
} from "./shared.js";

type CompanyDetailResponseData = Schematic.CompanyDetailResponseData;
type FeatureDetailResponseData = Schematic.FeatureDetailResponseData;
type CreateCompanyOverrideRequestBody = Schematic.CreateCompanyOverrideRequestBody;

export const companiesModule: ToolModule = {
  definitions: [
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
            description:
              "Custom key name to look up the company by (e.g., 'app_id'). Must be used with keyValue. See https://docs.schematichq.com/developer_resources/key_management",
          },
          keyValue: {
            type: "string",
            description:
              "Custom key value to look up the company by. Must be used with keyName.",
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
          keyName: {
            type: "string",
            description: "Custom key name for company lookup (requires keyValue)",
          },
          keyValue: {
            type: "string",
            description: "Custom key value for company lookup (requires keyName)",
          },
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
          keyName: {
            type: "string",
            description: "Custom key name for company lookup (requires keyValue)",
          },
          keyValue: {
            type: "string",
            description: "Custom key value for company lookup (requires keyName)",
          },
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
    {
      name: "list_company_overrides",
      description:
        "List company overrides. Filter by company (to see all overrides for a company) or by feature (to see which companies have an override for a feature)",
      inputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string", description: "Company ID to filter by" },
          companyName: { type: "string", description: "Company name to filter by" },
          featureName: {
            type: "string",
            description:
              "Feature name to filter by (finds which companies have an override for this feature)",
          },
          featureId: { type: "string", description: "Feature ID to filter by" },
        },
      },
    },
    {
      name: "set_company_override",
      description:
        "Set or update a company override for a feature/entitlement. REQUIRES a value parameter - always ask the user for the desired value before calling this tool. For boolean features: use 'on'/'off' or 'true'/'false'. For event-based or trait-based features: use a numeric value (e.g., '10', '100') or 'unlimited'.",
      inputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string" },
          companyName: { type: "string" },
          featureName: { type: "string" },
          featureId: { type: "string" },
          value: {
            type: "string",
            description:
              "REQUIRED: Override value. For boolean features: 'on'/'off' or 'true'/'false'. For event-based or trait-based features: a numeric value as a string (e.g., '10', '100') or 'unlimited'. Always ask the user for this value if not provided.",
          },
        },
        required: ["value"],
      },
    },
    {
      name: "remove_company_override",
      description:
        "Remove a company override for a feature/entitlement. This will delete the override and the company will fall back to their plan's entitlements.",
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
    {
      name: "get_manage_subscription_url",
      description:
        "Get the Schematic app URL where a company's subscription, checkout, and plan changes are managed. This MCP intentionally does not support checkout or plan-change mutations directly — use the returned URL to handle those flows in the Schematic app.",
      inputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string", description: "Schematic company ID (e.g., comp_xxx)" },
          companyName: { type: "string", description: "Company name" },
          stripeCustomerId: { type: "string", description: "Stripe customer ID" },
        },
      },
    },
  ],

  handlers: {
    async get_company(args) {
      const company = await resolveCompany(getSchematicClient(), {
        companyId: stringArg(args, "companyId"),
        companyName: stringArg(args, "companyName"),
        stripeCustomerId: stringArg(args, "stripeCustomerId"),
        keyName: stringArg(args, "keyName"),
        keyValue: stringArg(args, "keyValue"),
      });

      const stripeKey = company.keys?.find((k) => k.key === "stripe_customer_id");

      // Return the full company object so no API fields are dropped, plus the
      // derived dashboard links that aren't present in the raw API response.
      return jsonResponse({
        ...company,
        links: {
          schematic: getSchematicCompanyUrl(company.id),
          stripe: stripeKey ? getStripeCustomerUrl(stripeKey.value) : undefined,
        },
      });
    },

    async get_company_plan(args) {
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

      const planResponse = await getSchematicClient().plans.getPlan(company.plan.id);
      const plan = planResponse.data;

      return textResponse(
        `Company ${company.name || company.id} is on plan: ${plan.name} (${plan.id})`
      );
    },

    async get_company_trial_info(args) {
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

      const trialEndDate = new Date(trialEnd * 1000);
      const formattedDate = trialEndDate.toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      return textResponse(
        `Company ${company.name || company.id} is on a trial.\nTrial ends: ${formattedDate}`
      );
    },

    async link_stripe_to_schematic(args) {
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
    },

    async list_company_overrides(args) {
      const companyId = stringArg(args, "companyId");
      const companyName = stringArg(args, "companyName");
      const featureName = stringArg(args, "featureName");
      const featureId = stringArg(args, "featureId");

      const filterParams: {
        companyId?: string;
        featureId?: string;
        limit?: number;
      } = {
        limit: 100,
      };

      let company: CompanyDetailResponseData | undefined;
      if (companyId || companyName) {
        company = await resolveCompany(getSchematicClient(), {
          companyId,
          companyName,
        });
        filterParams.companyId = company.id;
      }

      let resolvedFeature: FeatureDetailResponseData | undefined;
      if (featureName || featureId) {
        resolvedFeature = await resolveFeature(getSchematicClient(), {
          featureId,
          featureName,
        });
        filterParams.featureId = resolvedFeature.id;
      }

      if (!filterParams.companyId && !filterParams.featureId) {
        throw new Error("Either companyId/companyName or featureId/featureName is required");
      }

      const overridesResponse = await getSchematicClient().entitlements.listCompanyOverrides(
        filterParams
      );
      const overrides = overridesResponse.data || [];

      if (overrides.length === 0) {
        if (company) {
          return textResponse(`Company ${company.name || company.id} has no overrides.`);
        } else if (resolvedFeature) {
          return textResponse(
            `No companies have an override for feature ${resolvedFeature.name || resolvedFeature.id}.`
          );
        }
        return textResponse("No overrides found.");
      }

      const results: string[] = [];

      if (company) {
        const features = await fetchAll(
          (params) => getSchematicClient().features.listFeatures(params),
          {}
        );
        const featureMap = new Map<string, FeatureDetailResponseData>();
        for (const feature of features) {
          featureMap.set(feature.id, feature);
        }

        results.push(
          `Company ${company.name || company.id} has ${overrides.length} override${overrides.length !== 1 ? "s" : ""}:`
        );
        for (const override of overrides) {
          const feature = featureMap.get(override.featureId);
          const featureDisplayName = feature?.name || override.featureId;
          results.push(
            `  - ${featureDisplayName} (${override.featureId}): ${formatOverrideValue(override)}`
          );
        }
      } else {
        const displayName = resolvedFeature?.name || resolvedFeature?.id;
        results.push(
          `${overrides.length} compan${overrides.length !== 1 ? "ies have" : "y has"} an override for feature ${displayName}:`
        );
        for (const override of overrides) {
          const overrideCompanyName = override.company?.name || override.companyId;
          results.push(`  - ${overrideCompanyName}: ${formatOverrideValue(override)}`);
        }
      }

      return textResponse(results.join("\n"));
    },

    async set_company_override(args) {
      const company = await resolveCompany(getSchematicClient(), {
        companyId: stringArg(args, "companyId"),
        companyName: stringArg(args, "companyName"),
      });

      const featureName = stringArg(args, "featureName");
      const featureId = stringArg(args, "featureId");
      const value = stringArg(args, "value");

      if (!value || value.trim() === "") {
        throw new Error(
          "Value is required. Please provide a value: 'on' or 'off' for boolean features, a number for event-based/trait-based features, or 'unlimited' for unlimited quota."
        );
      }

      const feature = await resolveFeature(getSchematicClient(), {
        featureId,
        featureName,
      });
      const featureType = feature.featureType;

      const requestBody: CreateCompanyOverrideRequestBody = {
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
          throw new Error(
            `Cannot set numeric override for feature "${feature.name || feature.id}". Numeric overrides are only supported for event-based or trait-based features. This feature is of type "${featureType}".`
          );
        }
      } else {
        requestBody.valueType = "boolean";
        requestBody.valueBool = true;
      }

      await getSchematicClient().entitlements.createCompanyOverride(requestBody);

      return textResponse(
        `Set override for company ${company.name || company.id}, feature ${feature.name || feature.id}: ${value}`
      );
    },

    async remove_company_override(args) {
      const company = await resolveCompany(getSchematicClient(), {
        companyId: stringArg(args, "companyId"),
        companyName: stringArg(args, "companyName"),
      });

      const feature = await resolveFeature(getSchematicClient(), {
        featureId: stringArg(args, "featureId"),
        featureName: stringArg(args, "featureName"),
      });

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

      await getSchematicClient().entitlements.deleteCompanyOverride(overrides[0].id);

      return textResponse(
        `Removed override for company ${company.name || company.id} on feature ${feature.name || feature.id}.`
      );
    },

    async get_manage_subscription_url(args) {
      const company = await resolveCompany(getSchematicClient(), {
        companyId: stringArg(args, "companyId"),
        companyName: stringArg(args, "companyName"),
        stripeCustomerId: stringArg(args, "stripeCustomerId"),
      });

      const url = getSchematicCompanyEntitlementsUrl(company.id);
      const lines = [
        `Subscription management for ${company.name || company.id} must be done in the Schematic app.`,
        `Checkout, plan changes, and add-on changes for this company are not supported via MCP — use the app to make these changes.`,
        ``,
        `URL: ${url}`,
      ];

      return textResponse(lines.join("\n"));
    },
  },
};
