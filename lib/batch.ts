import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { log } from "./log.js";

export async function processBatch(
  event: SQSEvent,
  process: (body: string, id: string) => Promise<void>,
): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  for (const record of event.Records) {
    try {
      await process(record.body, record.messageId);
      log("message_completed", record.messageId);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
      log("message_failed", record.messageId);
    }
  }

  return { batchItemFailures };
}
