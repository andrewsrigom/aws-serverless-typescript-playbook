import { z } from "zod";

export const Event = z
  .object({
    id: z.string().min(1).max(100),
    entityId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    revision: z.number().int().positive(),
    schemaVersion: z.literal(1),
  })
  .strict();

export type Event = z.infer<typeof Event>;

export const Enrichment = z
  .object({
    category: z.enum(["standard", "extended"]),
    providerVersion: z.literal("simulator-v1"),
  })
  .strict();

export type Enrichment = z.infer<typeof Enrichment>;
