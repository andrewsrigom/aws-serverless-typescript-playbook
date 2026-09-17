import type { DynamoDBStreamEvent, DynamoDBBatchResponse } from "aws-lambda";
import { log } from "../../../lib/log.js";

export async function processStream(
  event: DynamoDBStreamEvent,
  publish: (id: string) => Promise<void>,
): Promise<DynamoDBBatchResponse> {
  for (const record of event.Records) {
    if (record.eventName !== "INSERT") continue;

    const id = record.dynamodb?.Keys?.id?.S;
    const sequence = record.dynamodb?.SequenceNumber;

    if (!sequence) throw new Error("MissingStreamSequence");

    try {
      if (!id) throw new Error("MissingOutboxId");

      await publish(id);
      log("outbox_published", id);
    } catch {
      log("outbox_publish_failed", id ?? "unknown");

      // Stop at the first failed sequence to avoid processing later records repeatedly.
      return { batchItemFailures: [{ itemIdentifier: sequence }] };
    }
  }

  return { batchItemFailures: [] };
}
