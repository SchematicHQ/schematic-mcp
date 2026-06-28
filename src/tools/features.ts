import {
  resolveCompany,
  resolveFeature,
  fetchAll,
} from "../helpers.js";
import { getSchematicClient } from "../client.js";
import {
  ToolModule,
  generateFlagKey,
  requiredStringArg,
  stringArg,
  textResponse,
} from "./shared.js";

export const featuresModule: ToolModule = {
  definitions: [
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
            description:
              "Feature type: 'boolean' (simple on/off switch, most common), 'event' (metered against events that increase over time), or 'trait' (based on information that can fluctuate - must be created in web app). Defaults to 'boolean' if not specified.",
          },
          eventSubtype: {
            type: "string",
            description:
              "REQUIRED for event-based features: The event subtype to associate with this feature (e.g., 'api_call', 'report_generated').",
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
    {
      name: "get_feature_usage",
      description:
        "Get feature usage data for a company. Shows access status, usage vs allocation, and entitlement source for each feature. Optionally filter to a specific feature by providing featureId. If you only know the feature name, use list_features first to find the feature ID, then pass it here as featureId.",
      inputSchema: {
        type: "object",
        properties: {
          companyId: { type: "string", description: "Schematic company ID" },
          companyName: { type: "string", description: "Company name to search for" },
          featureId: {
            type: "string",
            description:
              "Optional: filter to a specific feature by ID. Use list_features to find the ID if you only have a name.",
          },
        },
      },
    },
  ],

  handlers: {
    async list_features() {
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
    },

    async create_feature(args) {
      const name = requiredStringArg(args, "name");
      const description = stringArg(args, "description");
      const featureTypeArg = stringArg(args, "featureType");
      if (featureTypeArg && !["boolean", "event", "trait"].includes(featureTypeArg)) {
        throw new Error(`Invalid featureType "${featureTypeArg}". Must be "boolean", "event", or "trait".`);
      }
      const featureType = (featureTypeArg as "boolean" | "event" | "trait") || "boolean";
      const eventSubtype = stringArg(args, "eventSubtype");

      if (name === name.toLowerCase()) {
        const titleCased = name
          .split(/\s+/)
          .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
          .join(" ");
        return textResponse(
          `The feature name "${name}" is all lowercase. Would you like to use "${titleCased}" or keep it as-is?`
        );
      }

      const finalDescription = description || "";

      if (featureType === "trait") {
        return textResponse(
          "Trait-based features must be created in the Schematic web app. Please visit https://app.schematichq.com/features to create trait-based features."
        );
      }

      if (featureType === "event" && !eventSubtype) {
        throw new Error("eventSubtype is required for event-based features");
      }

      const createFeatureBody: {
        name: string;
        description: string;
        featureType: "boolean" | "event";
        eventSubtype?: string;
      } = {
        name,
        description: finalDescription,
        featureType,
      };

      if (featureType === "event" && eventSubtype) {
        createFeatureBody.eventSubtype = eventSubtype;
      }

      const featureResponse = await getSchematicClient().features.createFeature(createFeatureBody);

      const feature = featureResponse.data;
      let result = `Created feature: ${feature.name} (${feature.id})`;

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

      return textResponse(result);
    },

    async get_feature_usage(args) {
      const companyId = stringArg(args, "companyId");
      const companyName = stringArg(args, "companyName");
      const featureId = stringArg(args, "featureId");

      if (!companyId && !companyName) {
        throw new Error("companyId or companyName is required");
      }

      const company = await resolveCompany(getSchematicClient(), { companyId, companyName });
      const companyDisplay = company.name || company.id;

      let featureDisplay: string | undefined;
      if (featureId) {
        const feature = await resolveFeature(getSchematicClient(), { featureId });
        featureDisplay = feature.name || feature.id;
      }

      const companyKeys: Record<string, string> = {};
      for (const k of company.keys) {
        companyKeys[k.key] = k.value;
      }

      const usageResponse = await getSchematicClient().entitlements.getFeatureUsageByCompany({
        keys: companyKeys,
      });
      let usageItems = usageResponse.data.features || [];

      if (featureId) {
        usageItems = usageItems.filter((item) => item.feature?.id === featureId);
      }

      if (usageItems.length === 0) {
        const context = featureDisplay
          ? `feature ${featureDisplay} at company ${companyDisplay}`
          : `company ${companyDisplay}`;
        return textResponse(`No feature usage data found for ${context}.`);
      }

      const results: string[] = [];
      if (featureDisplay) {
        results.push(`Feature usage for ${featureDisplay} at ${companyDisplay}:`);
      } else {
        results.push(
          `Feature usage for company ${companyDisplay} (${usageItems.length} feature${usageItems.length !== 1 ? "s" : ""}):`
        );
      }

      for (const item of usageItems) {
        const fname = item.feature?.name || "Unknown feature";
        const ftype = item.feature?.featureType || "unknown";
        const accessStr = item.access ? "allowed" : "denied";
        const source = item.entitlementSource || "unknown";

        const lines: string[] = [];
        lines.push(`  - ${fname} (${ftype}) — ${accessStr}`);

        if (ftype === "boolean") {
          lines.push(`    Source: ${source}`);
        } else {
          const usageVal = item.usage ?? 0;
          const allocationStr = item.isUnlimited ? "unlimited" : String(item.allocation ?? 0);
          const usageDisplay = item.isUnlimited
            ? `${usageVal} used (unlimited)`
            : `${usageVal} / ${allocationStr}`;
          lines.push(`    Usage: ${usageDisplay}`);
          if (!item.isUnlimited && item.percentUsed !== undefined) {
            lines.push(`    Percent used: ${Math.round(item.percentUsed)}%`);
          }
          lines.push(`    Source: ${source}`);
        }

        results.push(lines.join("\n"));
      }

      return textResponse(results.join("\n"));
    },
  },
};
