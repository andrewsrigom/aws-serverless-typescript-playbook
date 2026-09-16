import type { SQSEvent } from "aws-lambda";
import { z } from "zod";
import { once } from "./idempotency.js";
import { dynamoStore } from "./store.js";
import { processBatch } from "../../../lib/batch.js";
import { required } from "../../../lib/env.js";

const Job = z
  .object({ id: z.string().min(1).max(100), text: z.string().max(1000) })
  .strict();

export async function handler(event: SQSEvent) {
  return processBatch(event, async (body) => {
    const job = Job.parse(JSON.parse(body));

    await once(
      job.id,
      JSON.stringify(job),
      dynamoStore(required("TABLE_NAME")),
      async () => job.text.toUpperCase(),
    );
  });
}
