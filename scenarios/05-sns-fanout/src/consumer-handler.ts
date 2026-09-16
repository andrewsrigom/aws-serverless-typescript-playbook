import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { consume } from "./event.js";
import { required } from "../../../lib/env.js";
import { processBatch } from "../../../lib/batch.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export async function handler(event: SQSEvent) {
  return processBatch(event, (body) =>
    consume(body, async (change) => {
      await db.send(
        new PutCommand({ TableName: required("TABLE_NAME"), Item: change }),
      );
    }),
  );
}
