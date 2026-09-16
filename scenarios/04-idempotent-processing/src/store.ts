import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { Store } from "./idempotency.js";

const Entry = z.object({
  id: z.string(),
  fingerprint: z.string(),
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  token: z.string(),
  leaseUntil: z.number(),
  expiresAt: z.number(),
  result: z.string().optional(),
});

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export function dynamoStore(table: string): Store {
  return {
    async acquire(entry, now) {
      try {
        await db.send(
          new PutCommand({
            TableName: table,
            Item: entry,
            ConditionExpression:
              "attribute_not_exists(id) OR expiresAt <= :now OR (#s = :pending AND leaseUntil <= :now AND fingerprint = :fingerprint)",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
              ":now": now,
              ":pending": "IN_PROGRESS",
              ":fingerprint": entry.fingerprint,
            },
          }),
        );

        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "ConditionalCheckFailedException"
        )
          return false;

        throw error;
      }
    },
    async read(id) {
      const { Item } = await db.send(
        new GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }),
      );

      if (!Item) return undefined;

      const parsed = Entry.parse(Item);
      const { result, ...rest } = parsed;

      return result === undefined ? rest : { ...rest, result };
    },
    async complete(id, token, result, now) {
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: { id },
          UpdateExpression:
            "SET #s = :done, #r = :result, expiresAt = :expires",
          ConditionExpression:
            "#t = :token AND #s = :pending AND leaseUntil > :now",
          ExpressionAttributeNames: {
            "#s": "status",
            "#r": "result",
            "#t": "token",
          },
          ExpressionAttributeValues: {
            ":done": "COMPLETED",
            ":pending": "IN_PROGRESS",
            ":token": token,
            ":result": result,
            ":expires": now + 86400,
            ":now": now,
          },
        }),
      );
    },
    async release(id, token) {
      try {
        await db.send(
          new DeleteCommand({
            TableName: table,
            Key: { id },
            ConditionExpression: "#t = :token AND #s = :pending",
            ExpressionAttributeNames: { "#t": "token", "#s": "status" },
            ExpressionAttributeValues: {
              ":token": token,
              ":pending": "IN_PROGRESS",
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
  };
}
