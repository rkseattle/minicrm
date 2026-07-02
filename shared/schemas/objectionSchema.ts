/**
 * Shared types for the AI objection pattern matching feature. (MINCRM-471)
 * Used by both client and server.
 */

export const OBJECTION_CATEGORIES = [
  'Price',
  'Timing',
  'Competitor',
  'Product Fit',
  'Authority',
  'Risk',
  'Other',
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

export interface ActivityObjectionClassification {
  activity_id: string;
  category: ObjectionCategory;
}

export interface ObjectionPrecedent {
  deal_id: string;
  deal_name: string;
  objection_quote: string;
  response_summary: string;
  time_to_close_days: number;
}

export interface ObjectionPrecedentsResponse {
  category: ObjectionCategory;
  precedents: ObjectionPrecedent[];
  has_sufficient_data: boolean;
  min_closed_won_deals_required: number;
  closed_won_deals_count: number;
}
