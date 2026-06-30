/**
 * NLI tool definitions for Reports. (MINCRM-422, MINCRM-424)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const reportTools: Anthropic.Messages.Tool[] = [
  {
    name: 'generateReport',
    description:
      'Generate a CRM report inline in the conversation. Available types: win_loss (won vs lost deals by date range), activity_volume (activities logged per rep by date range), stage_trend (deal counts moving through pipeline stages over 30/60/90 days). To persist the report for later access, follow up with saveReport.',
    input_schema: {
      type: 'object',
      properties: {
        report_type: {
          type: 'string',
          enum: ['win_loss', 'activity_volume', 'stage_trend'],
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
          enum: ['win_loss', 'activity_volume', 'stage_trend'],
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
];
