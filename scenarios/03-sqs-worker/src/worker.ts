import { z } from "zod";

const Job = z
  .object({
    id: z.string().min(1),
    quantity: z.number().int().positive().max(1000),
  })
  .strict();

export interface JobStore {
  record(id: string, quantity: number): Promise<void>;
}

export async function processJob(body: string, store: JobStore): Promise<void> {
  const job = Job.parse(JSON.parse(body));

  await store.record(job.id, job.quantity);
}
