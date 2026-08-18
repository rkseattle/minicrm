/**
 * NLI tool definitions for Reports.
 */

import type Anthropic from '@anthropic-ai/sdk';

export const reportTools: Anthropic.Messages.Tool[] = [
  {
    name: 'generateReport',
    description:
      'Generate a CRM report inline in the conversation. Available types: win_loss (won vs lost deals by date range), activity_volume (activities logged per rep by date range), stage_trend (deal counts moving through pipeline stages over 30/60/90 days), leads_summary (lead counts broken down by status, e.g. New/Contacted/Qualified/Disqualified). Only call this tool when the request maps to one of these four types — if the user asks for a report on something else (e.g. a specific list of records already shown, or an entity/breakdown not covered above), do not call generateReport with a mismatched report_type; instead tell them what report types are available and ask which one they want, or offer to answer the question directly instead of generating a report.',
    input_schema: {
      type: 'object',
      properties: {
        report_type: {
          type: 'string',
          enum: ['win_loss', 'activity_volume', 'stage_trend', 'leads_summary'],
          description: 'The type of report to generate.',
        },
        pipeline_id: {
          type: 'string',
          description:
            'Filter the report to a specific pipeline. Defaults to the org default pipeline.',
        },
        date_from: {
          type: 'string',
          description: 'ISO date string (YYYY-MM-DD). Start of the reporting period.',
        },
        date_to: {
          type: 'string',
          description: 'ISO date string (YYYY-MM-DD). End of the reporting period.',
        },
        owner_id: {
          type: 'string',
          description: 'Scope the report to a single user (rep).',
        },
        currency: {
          type: 'string',
          description:
            '3-letter ISO currency code for monetary values in the report. Defaults to org currency.',
        },
        days: {
          type: 'number',
          enum: [30, 60, 90],
          description: 'Lookback window in days for the stage_trend report. Defaults to 30.',
        },
      },
      required: ['report_type'],
    },
  },
  {
    name: 'saveReport',
    description:
      'Save a previously generated NLI report to the Reports module so it can be accessed later. The user must have already run generateReport in this conversation. The saved report appears under "Custom Reports" in the Reports module.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Plain-language name for the saved report (e.g. "Q2 Dennis Pipeline").',
        },
        report_type: {
          type: 'string',
          enum: ['win_loss', 'activity_volume', 'stage_trend', 'leads_summary'],
          description: 'The report type that was generated.',
        },
        date_from: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). The start date used when the report was generated.',
        },
        date_to: {
          type: 'string',
          description:
            'ISO date string (YYYY-MM-DD). The end date used when the report was generated.',
        },
        owner_id: {
          type: 'string',
          description: 'The rep UUID the report was scoped to, if any.',
        },
        days: {
          type: 'number',
          enum: [30, 60, 90],
          description: 'Lookback window used for stage_trend reports.',
        },
      },
      required: ['name', 'report_type'],
    },
  },
  {
    name: 'getWinLossPatterns',
    description:
      'Returns the cached results of the nightly AI win/loss pattern analysis — plain-language observations about what correlates with winning and losing deals (e.g. "deals with a demo in week 1 close at 2.3x the rate"), plus loss reason trends. Does not trigger a new analysis; always serves the latest cached nightly run. Returns has_sufficient_data=false when there is not yet enough closed deal history. (MINCRM-464)',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
