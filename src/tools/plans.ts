import { Schematic } from "@schematichq/schematic-typescript-node";
import {
  resolvePlan,
  resolveFeature,
  fetchAll,
  getSchematicPlanUrl,
} from "../helpers.js";
import { getSchematicClient } from "../client.js";
import {
  ToolModule,
  arrayArg,
  booleanArg,
  requiredStringArg,
  stringArg,
  textResponse,
} from "./shared.js";

type CreatePlanEntitlementRequestBody = Schematic.CreatePlanEntitlementRequestBody;
type CreatePlanBundleRequestBody = Schematic.CreatePlanBundleRequestBody;

function finalizeInAppMessage(planId: string): string {
  return [
    `Note: this was written to the plan's draft version and is not live to customers until published.`,
    `Publishing must be done in the Schematic app — it can involve migrating companies between billing states.`,
    `Publish here: ${getSchematicPlanUrl(planId)}`,
  ].join("\n");
}

export const plansModule: ToolModule = {
  definitions: [
    {
      name: "list_plans",
      description: "List all plans in your Schematic account. Does not include add-ons.",
      inputSchema: {
        type: "object",
        properties: {},
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
      name: "create_plan",
      description:
        "Create a new plan. By default, this also creates a new Stripe-linked billing product (with optional monthly/yearly prices in dollars). Pass skipBilling: true to create a plan with no Stripe product. The tool gates creation behind a confirmation step: the first call returns a summary of what will be created and the user must approve before re-invoking with confirmed: true. The new plan is created as a draft version — publishing must be done in the Schematic app (use get_publish_plan_url to get the link).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Plan name" },
          description: { type: "string", description: "Plan description" },
          monthlyPrice: {
            type: "number",
            description:
              "Monthly price in dollars (e.g., 29.99 for $29.99/month). Defaults to 0. Ignored if skipBilling is true.",
          },
          yearlyPrice: {
            type: "number",
            description:
              "Yearly price in dollars (e.g., 299.99 for $299.99/year). Defaults to 0. Ignored if skipBilling is true.",
          },
          skipBilling: {
            type: "boolean",
            description:
              "Set to true to create the plan without a Stripe billing product. Defaults to false (creates a Stripe-linked plan).",
          },
          confirmed: {
            type: "boolean",
            description:
              "Set to true to actually execute creation after reviewing the summary. The first call should omit this; the tool returns a summary asking the user to confirm. Re-invoke with confirmed: true once the user approves.",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "add_entitlements_to_plan",
      description:
        "Add entitlements to a plan. The feature type will be automatically determined by querying the feature. For boolean features, defaults to 'on' if no value is provided. For event-based or trait-based features, a value (number or 'unlimited') is required. Changes are written to the plan's draft version — publishing must be done in the Schematic app (use get_publish_plan_url to get the link).",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "string" },
          planName: { type: "string" },
          entitlements: {
            type: "array",
            description:
              "Array of entitlement configurations. For boolean features, value is optional (defaults to 'on'). For event/trait features, value is required.",
            items: {
              type: "object",
              properties: {
                featureId: { type: "string" },
                featureName: { type: "string" },
                value: {
                  type: "string",
                  description:
                    "Optional for boolean features (defaults to 'on'). Required for event/trait features: a number as string (e.g., '10', '100') or 'unlimited'.",
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
      description:
        "Get all features/entitlements included in a plan. Shows what features a plan grants and their values (on/off for boolean, numeric limits for metered, unlimited).",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Plan ID (e.g., plan_xxx)" },
          planName: { type: "string", description: "Plan name" },
        },
      },
    },
    {
      name: "get_publish_plan_url",
      description:
        "Get the Schematic app URL where a plan's draft version can be published. Publishing must be done in the app because it can involve migrating companies between billing states. This MCP intentionally does not publish via API even though the SDK supports it.",
      inputSchema: {
        type: "object",
        properties: {
          planId: { type: "string", description: "Plan ID (e.g., plan_xxx)" },
          planName: { type: "string", description: "Plan name" },
        },
      },
    },
  ],

  handlers: {
    async list_plans() {
      const plans = await fetchAll(
        (params) => getSchematicClient().plans.listPlans(params),
        { planType: "plan" }
      );

      if (plans.length === 0) {
        return textResponse("No plans found.");
      }

      const planList = plans.map((plan) => `- ${plan.name} (${plan.id})`).join("\n");

      return textResponse(`Plans:\n${planList}`);
    },

    async count_companies_on_plan(args) {
      const plan = await resolvePlan(getSchematicClient(), {
        planId: stringArg(args, "planId"),
        planName: stringArg(args, "planName"),
      });

      const count = plan.companyCount || 0;

      return textResponse(
        `${count} compan${count !== 1 ? "ies" : "y"} ${count !== 1 ? "are" : "is"} on plan ${plan.name || plan.id}`
      );
    },

    async create_plan(args) {
      const name = requiredStringArg(args, "name");
      const description = stringArg(args, "description");
      const skipBilling = booleanArg(args, "skipBilling") ?? false;
      const confirmed = booleanArg(args, "confirmed") ?? false;

      if (name === name.toLowerCase()) {
        const titleCased = name
          .split(/\s+/)
          .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
          .join(" ");
        return textResponse(
          `The plan name "${name}" is all lowercase. Would you like to use "${titleCased}" or keep it as-is?`
        );
      }

      const monthlyPriceDollars = args?.["monthlyPrice"] as number | undefined;
      const yearlyPriceDollars = args?.["yearlyPrice"] as number | undefined;
      const monthlyPriceCents = Math.round((monthlyPriceDollars ?? 0) * 100);
      const yearlyPriceCents = Math.round((yearlyPriceDollars ?? 0) * 100);
      const isFree = monthlyPriceCents === 0 && yearlyPriceCents === 0;

      if (!confirmed) {
        const summary: string[] = [
          `About to create the following plan in Schematic:`,
          ``,
          `  Name: ${name}`,
          `  Description: ${description || "(none)"}`,
        ];

        if (skipBilling) {
          summary.push(`  Billing: none (skipBilling: true) — no Stripe product will be created`);
        } else {
          summary.push(
            `  Billing: NEW Stripe product will be created and linked`,
            `  Monthly price: ${monthlyPriceCents > 0 ? `$${(monthlyPriceCents / 100).toFixed(2)}/month` : "$0"}`,
            `  Yearly price: ${yearlyPriceCents > 0 ? `$${(yearlyPriceCents / 100).toFixed(2)}/year` : "$0"}`,
            `  Charge type: ${isFree ? "free" : "recurring"}`
          );
        }

        summary.push(
          ``,
          `This will create real state in Schematic${skipBilling ? "" : " AND Stripe"}.`,
          `Please confirm with the user before proceeding. To execute, call create_plan again with confirmed: true (plus the same other arguments).`
        );

        return textResponse(summary.join("\n"));
      }

      if (skipBilling) {
        const planResponse = await getSchematicClient().plans.createPlan({
          name,
          description: description || "",
          planType: "plan",
        });

        const plan = planResponse.data;

        const lines = [
          `Created plan: ${plan.name} (${plan.id})`,
          `No Stripe billing product was created (skipBilling: true).`,
          ``,
          finalizeInAppMessage(plan.id),
        ];

        return textResponse(lines.join("\n"));
      }

      const requestBody: CreatePlanBundleRequestBody = {
        plan: {
          name,
          description: description || "",
          planType: "plan",
        },
        billingProduct: {
          chargeType: isFree ? "free" : "recurring",
          isTrialable: false,
          trialDays: 0,
          currency: "usd",
          monthlyPrice: monthlyPriceCents,
          yearlyPrice: yearlyPriceCents,
        },
        entitlements: [],
      };

      const bundleResponse = await getSchematicClient().planbundle.createPlanBundle(requestBody);
      const bundle = bundleResponse.data;
      const plan = bundle.plan ?? { name, id: "unknown" };

      const lines: string[] = [
        `Created plan: ${plan.name} (${plan.id})`,
        `Stripe billing product created and linked.`,
      ];

      if (monthlyPriceCents > 0 || yearlyPriceCents > 0) {
        if (monthlyPriceCents > 0) {
          lines.push(`Monthly price: $${(monthlyPriceCents / 100).toFixed(2)}/month`);
        }
        if (yearlyPriceCents > 0) {
          lines.push(`Yearly price: $${(yearlyPriceCents / 100).toFixed(2)}/year`);
        }
      } else {
        lines.push("Pricing: $0 (update prices in Stripe or Schematic dashboard)");
      }

      lines.push(``, finalizeInAppMessage(plan.id));

      return textResponse(lines.join("\n"));
    },

    async add_entitlements_to_plan(args) {
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
            throw new Error(
              `Value is required for ${featureType}-based feature "${featureDisplay}". Please provide a number (e.g., "10", "100") or "unlimited".`
            );
          }

          if (entitlement.value === "unlimited") {
            entitlementBody.valueType = "unlimited";
          } else if (!isNaN(Number(entitlement.value))) {
            entitlementBody.valueType = "numeric";
            entitlementBody.valueNumeric = Number(entitlement.value);
          } else {
            throw new Error(
              `Invalid value "${entitlement.value}" for ${featureType}-based feature "${featureDisplay}". Must be a number or "unlimited".`
            );
          }
        } else {
          throw new Error(`Unsupported feature type "${featureType}" for feature "${featureDisplay}".`);
        }

        await getSchematicClient().entitlements.createPlanEntitlement(entitlementBody);

        const valueDisplay = entitlement.value || (featureType === "boolean" ? "on" : "not provided");
        results.push(`Added ${featureType} entitlement for feature ${featureDisplay}: ${valueDisplay}`);
      }

      results.push(``, finalizeInAppMessage(plan.id));

      return textResponse(results.join("\n"));
    },

    async get_plan_entitlements(args) {
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

      const results: string[] = [
        `Plan ${plan.name} (${plan.id}) has ${entitlements.length} entitlement${entitlements.length !== 1 ? "s" : ""}:`,
      ];

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
    },

    async get_publish_plan_url(args) {
      const plan = await resolvePlan(getSchematicClient(), {
        planId: stringArg(args, "planId"),
        planName: stringArg(args, "planName"),
      });

      const url = getSchematicPlanUrl(plan.id);
      const lines = [
        `Publishing plan "${plan.name || plan.id}" must be done in the Schematic app.`,
        `Publishing can involve migrating companies between billing states, so it is not supported via MCP.`,
        ``,
        `URL: ${url}`,
      ];

      return textResponse(lines.join("\n"));
    },
  },
};
