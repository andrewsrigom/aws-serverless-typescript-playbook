import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { outboxStore, dispatch } from "./outbox.js";
import { required } from "../../../lib/env.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

const sqs = new SQSClient({ maxAttempts: 3 });

export function store() {
  return outboxStore(db, required("ORDERS_TABLE"), required("OUTBOX_TABLE"));
}

export async function publish(id: string) {
  await dispatch(id, store(), async (order) => {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: required("QUEUE_URL"),
        MessageBody: JSON.stringify({
          version: 1,
          type: "order.created",
          eventId: order.id,
          order,
        }),
      }),
    );
  });
}
