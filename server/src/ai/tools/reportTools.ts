/**
 * NLI tool definitions for Reports. (MINCRM-422)
 */

import type Anthropic from '@anthropic-ai/sdk';

export const reportTools: Anthropic.Messages.Tool[] = [
  {
    name: 'generateReport',
    description:
      'Generate a CRM report. Available types: win_loss (won vs lost deals by date range), activity_volume (activities logged per rep by date range), stage_trend (deal counts moving through pipeline stages over 30/60/90 days).',
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
];
