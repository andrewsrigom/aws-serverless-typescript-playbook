import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { Store } from "./reconcile.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

const Key = z.object({ id: z.string() }).strict();

export function store(table: string, checkpoints: string): Store {
  return {
    async checkpoint() {
      const { Item } = await db.send(
        new GetCommand({
          TableName: checkpoints,
          Key: { id: "scan" },
          ConsistentRead: true,
        }),
      );

      return typeof Item?.cursor === "string" ? Item.cursor : undefined;
    },
    async page(cursor) {
      const key = cursor ? Key.parse(JSON.parse(cursor)) : undefined;
      const result = await db.send(
        new ScanCommand({
          TableName: table,
          Limit: 25,
          FilterExpression: "#s = :pending",
          ProjectionExpression: "id",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":pending": "PENDING" },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );

      return {
        ids: (result.Items ?? []).map((item) => Key.parse(item).id),
        ...(result.LastEvaluatedKey
          ? { cursor: JSON.stringify(Key.parse(result.LastEvaluatedKey)) }
          : {}),
      };
    },
    async reconcile(id) {
      try {
        await db.send(
          new UpdateCommand({
            TableName: table,
            Key: { id },
            UpdateExpression: "SET #s = :done",
            ConditionExpression: "#s = :pending",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":done": "RECONCILED",
            },
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "ConditionalCheckFailedException"
        )
          throw error;
      }
    },
    async save(cursor) {
      await db.send(
        new PutCommand({
          TableName: checkpoints,
          Item: { id: "scan", ...(cursor ? { cursor } : {}) },
        }),
      );
    },
  };
}
