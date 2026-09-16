import type { SQSEvent } from "aws-lambda";
import { processEvent } from "./worker.js";
import { enrich } from "./provider.js";
import { store } from "./store.js";
import { required } from "../../../lib/env.js";
import { processBatch } from "../../../lib/batch.js";

export async function handler(event: SQSEvent) {
  return processBatch(event, async (body) => {
    await processEvent(body, store(required("TABLE_NAME")), (id) =>
      enrich(id, required("PROVIDER_URL")),
    );
  });
}
