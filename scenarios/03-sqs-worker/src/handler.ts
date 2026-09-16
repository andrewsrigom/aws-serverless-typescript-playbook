import type { SQSEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { processJob } from "./worker.js";
import { processBatch } from "../../../lib/batch.js";
import { required } from "../../../lib/env.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export async function handler(event: SQSEvent) {
  return processBatch(event, (body) =>
    processJob(body, {
      async record(id, quantity) {
        await db.send(
          new PutCommand({
            TableName: required("TABLE_NAME"),
            Item: { id, quantity, status: "RECORDED" },
          }),
        );
      },
    }),
  );
}
