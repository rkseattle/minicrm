import { z } from 'zod';

/** One merge tag a template declares: the token it fills, and the label a picker shows. */
export const mergeTagSchema = z.object({ key: z.string(), label: z.string() });

export type MergeTag = z.infer<typeof mergeTagSchema>;

/** A template as a sender picks it: what it says, and the tags it will fill in. */
export const emailTemplateSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  subject: z.string(),
  body: z.string(),
  merge_tags: z.array(mergeTagSchema),
});

export type EmailTemplateSummary = z.infer<typeof emailTemplateSummarySchema>;
