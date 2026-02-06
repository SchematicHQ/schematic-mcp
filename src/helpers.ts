/**
 * Helper functions for company resolution and data formatting
 */

import { SchematicClient, Schematic } from "@schematichq/schematic-typescript-node";

type CompanyDetailResponseData = Schematic.CompanyDetailResponseData;

export interface CompanyIdentifier {
  companyId?: string;
  companyName?: string;
  stripeCustomerId?: string;
  internalAppId?: string;
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
    const response = await client.companies.listCompanies({
      q: identifier.companyName,
    });
    const companies = response.data || [];
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

  // Internal app ID lookup
  if (identifier.internalAppId) {
    // First, we need to find a company that has this in their keys
    // List companies and check keys, then use lookup
    const response = await client.companies.listCompanies({});
    const companies = response.data || [];
    
    for (const company of companies) {
      if (company.keys && Array.isArray(company.keys)) {
        // Check if any key value matches the internal app ID
        for (const keyDetail of company.keys) {
          if (keyDetail.value === identifier.internalAppId) {
            // Found it! Now use lookup with this key
            const lookupResponse = await client.companies.lookupCompany({
              keys: {
                [keyDetail.key]: identifier.internalAppId,
              },
            });
            return lookupResponse.data;
          }
        }
      }
    }
    
    throw new Error(
      `No company found with internal app ID "${identifier.internalAppId}"`
    );
  }

  throw new Error("No valid company identifier provided");
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

