/**
 * Helper functions for company resolution and data formatting
 */

import { SchematicClient, Schematic } from "@schematichq/schematic-typescript-node";

type CompanyDetailResponseData = Schematic.CompanyDetailResponseData;
type FeatureDetailResponseData = Schematic.FeatureDetailResponseData;
type PlanDetailResponseData = Schematic.PlanDetailResponseData;

const PAGE_SIZE = 100;

/**
 * Fetches all pages from a paginated Schematic list endpoint.
 */
export async function fetchAll<TItem>(
  listFn: (params: Record<string, unknown>) => Promise<{ data: TItem[] }>,
  baseParams: Record<string, unknown>
): Promise<TItem[]> {
  const allItems: TItem[] = [];
  let offset = 0;

  while (true) {
    const response = await listFn({ ...baseParams, limit: PAGE_SIZE, offset });
    const items = response.data || [];
    allItems.push(...items);
    if (items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allItems;
}

export interface CompanyIdentifier {
  companyId?: string;
  companyName?: string;
  stripeCustomerId?: string;
  keyName?: string;
  keyValue?: string;
}

/**
 * Resolves a company using various identifier types
 */
export async function resolveCompany(
  client: SchematicClient,
  identifier: CompanyIdentifier
): Promise<CompanyDetailResponseData> {
  // Direct company ID lookup
  if (identifier.companyId) {
    const response = await client.companies.getCompany(identifier.companyId);
    return response.data;
  }

  // Stripe customer ID lookup
  if (identifier.stripeCustomerId) {
    const response = await client.companies.lookupCompany({
      keys: {
        stripe_customer_id: identifier.stripeCustomerId,
      },
    });
    return response.data;
  }

  // Company name search
  if (identifier.companyName) {
    const companies = await fetchAll(
      (params) => client.companies.listCompanies(params),
      { q: identifier.companyName }
    );
    if (companies.length === 0) {
      throw new Error(`No company found with name "${identifier.companyName}"`);
    }
    if (companies.length > 1) {
      const names = companies.map((c) => c.name || c.id).join(", ");
      throw new Error(
        `Multiple companies found matching "${identifier.companyName}": ${names}. Please be more specific or use company ID.`
      );
    }
    return companies[0];
  }

  // Custom key lookup
  if (identifier.keyName || identifier.keyValue) {
    if (!identifier.keyName || !identifier.keyValue) {
      throw new Error(
        "Both keyName and keyValue are required for custom key lookup. " +
        "Key names are configured in Schematic - see https://docs.schematichq.com/developer_resources/key_management"
      );
    }
    const response = await client.companies.lookupCompany({
      keys: {
        [identifier.keyName]: identifier.keyValue,
      },
    });
    return response.data;
  }

  throw new Error("No valid company identifier provided");
}

export interface FeatureIdentifier {
  featureId?: string;
  featureName?: string;
}

/**
 * Resolves a feature by ID or name (matches on name or flag key)
 */
export async function resolveFeature(
  client: SchematicClient,
  identifier: FeatureIdentifier
): Promise<FeatureDetailResponseData> {
  if (identifier.featureId) {
    const response = await client.features.getFeature(identifier.featureId);
    return response.data;
  }

  if (identifier.featureName) {
    const features = await fetchAll(
      (params) => client.features.listFeatures(params),
      {}
    );
    const feature = features.find(
      (f) => f.name === identifier.featureName || f.flags?.[0]?.key === identifier.featureName
    );
    if (!feature) {
      throw new Error(`Feature "${identifier.featureName}" not found`);
    }
    return feature;
  }

  throw new Error("Either featureId or featureName is required");
}

export interface PlanIdentifier {
  planId?: string;
  planName?: string;
}

/**
 * Resolves a plan by ID or name
 */
export async function resolvePlan(
  client: SchematicClient,
  identifier: PlanIdentifier
): Promise<PlanDetailResponseData> {
  if (identifier.planId) {
    const response = await client.plans.getPlan(identifier.planId);
    return response.data;
  }

  if (identifier.planName) {
    const plans = await fetchAll(
      (params) => client.plans.listPlans(params),
      {}
    );
    const plan = plans.find((p) => p.name === identifier.planName);
    if (!plan) {
      throw new Error(`Plan "${identifier.planName}" not found`);
    }
    return plan;
  }

  throw new Error("Either planId or planName is required");
}

/**
 * Generates a SchematicHQ URL for a company
 */
export function getSchematicCompanyUrl(companyId: string): string {
  return `https://app.schematichq.com/env/companies/${companyId}`;
}

/**
 * Generates a Stripe dashboard URL for a customer
 */
export function getStripeCustomerUrl(stripeCustomerId: string): string {
  return `https://dashboard.stripe.com/customers/${stripeCustomerId}`;
}

