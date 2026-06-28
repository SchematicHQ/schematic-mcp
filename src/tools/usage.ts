import { fetchAll, getSchematicCompanyUrl } from "../helpers.js";
import { getSchematicClient } from "../client.js";
import { ToolModule, arrayArg, stringArg, textResponse } from "./shared.js";

export const usageModule: ToolModule = {
  definitions: [
    {
      name: "find_companies_near_limit",
      description:
        "Find companies at or above a usage threshold for a specific metered feature. Queries all companies for the given feature sorted by usage percentage (highest first), stopping as soon as usage drops below the threshold. If no featureId is provided, returns a list of metered features to choose from.",
      inputSchema: {
        type: "object",
        properties: {
          featureId: {
            type: "string",
            description:
              "ID of the metered feature to scan. If omitted, the tool returns a list of available metered features to choose from.",
          },
          threshold: {
            type: "number",
            description:
              "Usage percentage threshold (0-100). Companies at or above this percentage are included. Defaults to 70.",
          },
        },
      },
    },
    {
      name: "check_companies_usage",
      description:
        "Check feature usage for a specific list of companies and identify which are at or above a usage threshold for any metered feature. Useful for proactive health checks on known accounts. Results are grouped by feature and sorted by percent used.",
      inputSchema: {
        type: "object",
        properties: {
          companyIds: {
            type: "array",
            items: { type: "string" },
            description:
              "List of Schematic company IDs to check (e.g., ['comp_xxx', 'comp_yyy'])",
          },
          threshold: {
            type: "number",
            description:
              "Usage percentage threshold (0-100). Companies at or above this percentage are included. Defaults to 70.",
          },
        },
        required: ["companyIds"],
      },
    },
  ],

  handlers: {
    async find_companies_near_limit(args) {
      const thresholdArg = args?.["threshold"];
      const threshold = typeof thresholdArg === "number" ? thresholdArg : 70;
      const featureId = stringArg(args, "featureId");

      if (!featureId) {
        const features = await fetchAll(
          (params) => getSchematicClient().features.listFeatures(params),
          {}
        );
        const metered = features.filter(
          (f) => f.featureType === "event" || f.featureType === "trait"
        );
        if (metered.length === 0) {
          return textResponse(
            "No metered features found. This tool requires a metered (event-based or trait-based) feature."
          );
        }
        const list = metered.map((f) => `- ${f.name} (${f.id})`).join("\n");
        return textResponse(
          `Please provide a featureId to scan. Available metered features:\n${list}`
        );
      }

      interface NearLimitResult {
        companyId: string;
        companyName: string;
        featureName: string;
        featureId: string;
        usage: number;
        allocation: number;
        percentUsed: number;
      }

      const allResults: NearLimitResult[] = [];

      const PAGE_SIZE = 100;
      let offset = 0;
      let done = false;

      while (!done) {
        const resp = await getSchematicClient().entitlements.listFeatureCompanies({
          featureId,
          limit: PAGE_SIZE,
          offset,
        });
        const items = resp.data ?? [];

        for (const item of items) {
          if (item.isUnlimited || item.percentUsed === undefined || item.percentUsed === null) continue;
          if (item.percentUsed < threshold) {
            done = true;
            break;
          }
          allResults.push({
            companyId: item.company?.id ?? "unknown",
            companyName: item.company?.name ?? item.company?.id ?? "Unknown",
            featureName: item.feature?.name ?? "Unknown",
            featureId: item.feature?.id ?? featureId,
            usage: item.usage ?? 0,
            allocation: item.allocation ?? 0,
            percentUsed: item.percentUsed,
          });
        }

        if (!done) {
          if (items.length < PAGE_SIZE) done = true;
          else offset += PAGE_SIZE;
        }
      }

      const scopeLabel = `feature ${featureId}`;

      if (allResults.length === 0) {
        return textResponse(`No features at or above ${threshold}% usage found across ${scopeLabel}.`);
      }

      const byFeature = new Map<string, NearLimitResult[]>();
      for (const r of allResults) {
        if (!byFeature.has(r.featureName)) byFeature.set(r.featureName, []);
        byFeature.get(r.featureName)!.push(r);
      }

      const lines: string[] = [
        `Found ${allResults.length} feature usage(s) at or above ${threshold}% across ${scopeLabel}:\n`,
      ];

      for (const [fname, rows] of byFeature) {
        lines.push(`Feature: ${fname} (${rows[0].featureId}) — ${rows.length} company/companies`);
        for (const r of rows) {
          const pct = Math.round(r.percentUsed);
          lines.push(`  ${pct}%  ${r.usage}/${r.allocation}  ${r.companyName} (${r.companyId})`);
          lines.push(`       ${getSchematicCompanyUrl(r.companyId)}`);
        }
        lines.push("");
      }

      return textResponse(lines.join("\n"));
    },

    async check_companies_usage(args) {
      const companyIds = arrayArg<string>(args, "companyIds");
      if (!companyIds || companyIds.length === 0) {
        throw new Error("companyIds is required and must not be empty");
      }

      const thresholdArg = args?.["threshold"];
      const threshold = typeof thresholdArg === "number" ? thresholdArg : 70;

      interface UsageResult {
        companyId: string;
        companyName: string;
        featureName: string;
        featureId: string;
        usage: number;
        allocation: number;
        percentUsed: number;
      }

      const allResults: UsageResult[] = [];
      const errors: { companyId: string; error: string }[] = [];

      const CONCURRENCY = 10;
      let idx = 0;

      async function worker() {
        while (idx < companyIds!.length) {
          const cid = companyIds![idx++];
          try {
            const companyResp = await getSchematicClient().companies.getCompany(cid);
            const company = companyResp.data;

            const companyKeys: Record<string, string> = {};
            for (const k of company.keys) {
              companyKeys[k.key] = k.value;
            }

            if (Object.keys(companyKeys).length === 0) continue;

            const usageResp = await getSchematicClient().entitlements.getFeatureUsageByCompany({
              keys: companyKeys,
            });
            const features = usageResp.data.features ?? [];

            for (const item of features) {
              if (item.isUnlimited || item.percentUsed === undefined || item.percentUsed === null) continue;
              if (item.percentUsed >= threshold) {
                allResults.push({
                  companyId: company.id,
                  companyName: company.name ?? company.id,
                  featureName: item.feature?.name ?? "Unknown",
                  featureId: item.feature?.id ?? "unknown",
                  usage: item.usage ?? 0,
                  allocation: item.allocation ?? 0,
                  percentUsed: item.percentUsed,
                });
              }
            }
          } catch (err: unknown) {
            errors.push({
              companyId: cid,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      allResults.sort((a, b) => b.percentUsed - a.percentUsed);

      if (allResults.length === 0) {
        const errNote = errors.length > 0 ? ` (${errors.length} companies could not be checked)` : "";
        return textResponse(
          `No features at or above ${threshold}% usage found across ${companyIds.length} companies${errNote}.`
        );
      }

      const byFeature = new Map<string, UsageResult[]>();
      for (const r of allResults) {
        if (!byFeature.has(r.featureName)) byFeature.set(r.featureName, []);
        byFeature.get(r.featureName)!.push(r);
      }

      const lines: string[] = [
        `Found ${allResults.length} feature usage(s) at or above ${threshold}% across ${companyIds.length} companies:\n`,
      ];

      for (const [fname, rows] of byFeature) {
        lines.push(`Feature: ${fname} (${rows[0].featureId}) — ${rows.length} company/companies`);
        for (const r of rows) {
          const pct = Math.round(r.percentUsed);
          lines.push(`  ${pct}%  ${r.usage}/${r.allocation}  ${r.companyName} (${r.companyId})`);
          lines.push(`       ${getSchematicCompanyUrl(r.companyId)}`);
        }
        lines.push("");
      }

      if (errors.length > 0) {
        lines.push(`${errors.length} company/companies could not be checked (lookup failed).`);
      }

      return textResponse(lines.join("\n"));
    },
  },
};
