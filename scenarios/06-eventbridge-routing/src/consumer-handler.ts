import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DomainEvent } from "./events.js";
import { required } from "../../../lib/env.js";
import { processBatch } from "../../../lib/batch.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export async function handler(event: SQSEvent) {
  return processBatch(event, async (body) => {
    const domain = DomainEvent.parse(JSON.parse(body));

    if (domain["detail-type"] !== required("EXPECTED_TYPE"))
      throw Error("Wrong route");

    await db.send(
      new PutCommand({
        TableName: required("TABLE_NAME"),
        Item: { ...domain.detail, kind: domain["detail-type"] },
      }),
    );
  });
}
