import { Schematic } from "@schematichq/schematic-typescript-node";
import {
  resolveAddon,
  resolveFeature,
  fetchAll,
  getSchematicPlanUrl,
} from "../helpers.js";
import { getSchematicClient } from "../client.js";
import {
  ToolModule,
  arrayArg,
  formatEntitlementValue,
  requiredStringArg,
  stringArg,
  textResponse,
} from "./shared.js";

type CreatePlanEntitlementRequestBody = Schematic.CreatePlanEntitlementRequestBody;

function finalizeInAppMessage(addonId: string): string {
  return [
    `Note: this was written to the add-on's draft version and is not live to customers until published.`,
    `Publishing must be done in the Schematic app — it can involve migrating companies between billing states.`,
    `Publish here: ${getSchematicPlanUrl(addonId)}`,
  ].join("\n");
}

export const addonsModule: ToolModule = {
  definitions: [
    {
      name: "list_addons",
      description: "List all add-ons in your Schematic account",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "create_addon",
      description:
        "Create a new add-on. The new add-on is created as a draft version — publishing must be done in the Schematic app (use get_publish_addon_url to get the link).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Add-on name" },
          description: { type: "string", description: "Add-on description" },
        },
        required: ["name"],
      },
    },
    {
      name: "add_entitlements_to_addon",
      description:
        "Add entitlements to an add-on. The feature type will be automatically determined by querying the feature. For boolean features, defaults to 'on' if no value is provided. For trait-based features, a value (number or 'unlimited') is required. Event-based features are NOT supported as add-on entitlements by the API and will be skipped with an error. Changes are written to the add-on's draft version — publishing must be done in the Schematic app (use get_publish_addon_url to get the link).",
      inputSchema: {
        type: "object",
        properties: {
          addonId: { type: "string", description: "Add-on ID (e.g., plan_xxx)" },
          addonName: { type: "string", description: "Add-on name" },
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
      name: "get_addon_entitlements",
      description:
        "Get the entitlements currently published on an add-on. Shows what features the add-on grants live customers and their values. Does NOT reflect pending changes in the draft version — those only appear after the add-on is published in the Schematic app.",
      inputSchema: {
        type: "object",
        properties: {
          addonId: { type: "string", description: "Add-on ID (e.g., plan_xxx)" },
          addonName: { type: "string", description: "Add-on name" },
        },
      },
    },
    {
      name: "count_companies_on_addon",
      description: "Count how many companies have a specific add-on",
      inputSchema: {
        type: "object",
        properties: {
          addonId: { type: "string", description: "Add-on ID (e.g., plan_xxx)" },
          addonName: { type: "string", description: "Add-on name" },
        },
      },
    },
    {
      name: "get_publish_addon_url",
      description:
        "Get the Schematic app URL where an add-on's draft version can be published. Publishing must be done in the app because it can involve migrating companies between billing states. This MCP intentionally does not publish via API even though the SDK supports it.",
      inputSchema: {
        type: "object",
        properties: {
          addonId: { type: "string", description: "Add-on ID (e.g., plan_xxx)" },
          addonName: { type: "string", description: "Add-on name" },
        },
      },
    },
  ],

  handlers: {
    async list_addons() {
      const addons = await fetchAll(
        (params) => getSchematicClient().plans.listPlans(params),
        { planType: "add_on" }
      );

      if (addons.length === 0) {
        return textResponse("No add-ons found.");
      }

      const addonList = addons.map((addon) => `- ${addon.name} (${addon.id})`).join("\n");

      return textResponse(`Add-ons:\n${addonList}`);
    },

    async create_addon(args) {
      const name = requiredStringArg(args, "name");
      const description = stringArg(args, "description");

      const addonResponse = await getSchematicClient().plans.createPlan({
        name,
        description: description || "",
        planType: "add_on",
      });

      const addon = addonResponse.data;

      const lines = [
        `Created add-on: ${addon.name} (${addon.id})`,
        ``,
        finalizeInAppMessage(addon.id),
      ];

      return textResponse(lines.join("\n"));
    },

    async add_entitlements_to_addon(args) {
      const addonId = stringArg(args, "addonId");
      const addonName = stringArg(args, "addonName");
      const entitlements = arrayArg<{
        featureId?: string;
        featureName?: string;
        value?: string;
      }>(args, "entitlements");

      const addon = await resolveAddon(getSchematicClient(), { addonId, addonName });

      if (!entitlements || entitlements.length === 0) {
        throw new Error("At least one entitlement is required");
      }

      const successes: string[] = [];
      const failures: string[] = [];

      for (const entitlement of entitlements) {
        let featureDisplay = entitlement.featureName || entitlement.featureId || "(unknown feature)";
        try {
          const feature = await resolveFeature(getSchematicClient(), {
            featureId: entitlement.featureId,
            featureName: entitlement.featureName,
          });
          const featureType = feature.featureType;
          featureDisplay = feature.name || feature.id;

          if (featureType === "event") {
            throw new Error(
              `Event-based features are not supported as add-on entitlements by the Schematic API. "${featureDisplay}" is an event feature.`
            );
          }

          const entitlementBody: CreatePlanEntitlementRequestBody = {
            planId: addon.id,
            featureId: feature.id,
            valueType: "boolean",
          };

          if (featureType === "boolean") {
            const value = entitlement.value || "on";
            entitlementBody.valueType = "boolean";
            entitlementBody.valueBool = value === "on" || value === "true";
          } else if (featureType === "trait") {
            if (!entitlement.value) {
              throw new Error(
                `Value is required for trait-based feature "${featureDisplay}". Please provide a number (e.g., "10", "100") or "unlimited".`
              );
            }

            if (entitlement.value === "unlimited") {
              entitlementBody.valueType = "unlimited";
            } else if (!isNaN(Number(entitlement.value))) {
              entitlementBody.valueType = "numeric";
              entitlementBody.valueNumeric = Number(entitlement.value);
            } else {
              throw new Error(
                `Invalid value "${entitlement.value}" for trait-based feature "${featureDisplay}". Must be a number or "unlimited".`
              );
            }
          } else {
            throw new Error(`Unsupported feature type "${featureType}" for feature "${featureDisplay}".`);
          }

          await getSchematicClient().entitlements.createPlanEntitlement(entitlementBody);

          const valueDisplay = entitlement.value || (featureType === "boolean" ? "on" : "not provided");
          successes.push(`Added ${featureType} entitlement for feature ${featureDisplay}: ${valueDisplay}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`Failed to add entitlement for feature ${featureDisplay}: ${message}`);
        }
      }

      const results: string[] = [];
      if (successes.length > 0) results.push(...successes);
      if (failures.length > 0) {
        if (results.length > 0) results.push("");
        results.push(...failures);
      }
      if (successes.length > 0) {
        results.push("", finalizeInAppMessage(addon.id));
      }

      return textResponse(results.join("\n"));
    },

    async get_addon_entitlements(args) {
      const addon = await resolveAddon(getSchematicClient(), {
        addonId: stringArg(args, "addonId"),
        addonName: stringArg(args, "addonName"),
      });

      const entitlements = await fetchAll(
        (params) => getSchematicClient().entitlements.listPlanEntitlements(params),
        { planId: addon.id }
      );

      if (entitlements.length === 0) {
        return textResponse(`Add-on ${addon.name || addon.id} has no entitlements.`);
      }

      const results: string[] = [
        `Add-on ${addon.name} (${addon.id}) has ${entitlements.length} entitlement${entitlements.length !== 1 ? "s" : ""}:`,
      ];

      for (const entitlement of entitlements) {
        const featureName = entitlement.feature?.name || entitlement.featureId;
        const featureType = entitlement.feature?.featureType || "unknown";
        const valueDisplay = formatEntitlementValue(entitlement);

        results.push(`  - ${featureName} (${featureType}): ${valueDisplay}`);
      }

      return textResponse(results.join("\n"));
    },

    async count_companies_on_addon(args) {
      const addon = await resolveAddon(getSchematicClient(), {
        addonId: stringArg(args, "addonId"),
        addonName: stringArg(args, "addonName"),
      });

      const count = addon.companyCount || 0;

      return textResponse(
        `${count} compan${count !== 1 ? "ies" : "y"} ${count !== 1 ? "are" : "is"} on add-on ${addon.name || addon.id}`
      );
    },

    async get_publish_addon_url(args) {
      const addon = await resolveAddon(getSchematicClient(), {
        addonId: stringArg(args, "addonId"),
        addonName: stringArg(args, "addonName"),
      });

      const url = getSchematicPlanUrl(addon.id);
      const lines = [
        `Publishing add-on "${addon.name || addon.id}" must be done in the Schematic app.`,
        `Publishing can involve migrating companies between billing states, so it is not supported via MCP.`,
        ``,
        `URL: ${url}`,
      ];

      return textResponse(lines.join("\n"));
    },
  },
};
