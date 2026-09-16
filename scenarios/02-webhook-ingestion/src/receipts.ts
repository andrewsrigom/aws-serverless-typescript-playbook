import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ReceiptStore } from "./protocol.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export function receipts(table: string): ReceiptStore {
  return {
    async claim(id, token, now) {
      try {
        await db.send(
          new UpdateCommand({
            TableName: table,
            Key: { id },
            UpdateExpression:
              "SET #s = :pending, #t = :token, leaseUntil = :lease, expiresAt = :expires",
            ConditionExpression:
              "attribute_not_exists(id) OR expiresAt <= :now OR (#s = :pending AND leaseUntil <= :now)",
            ExpressionAttributeNames: { "#s": "status", "#t": "token" },
            ExpressionAttributeValues: {
              ":pending": "PENDING",
              ":token": token,
              ":lease": now + 30,
              ":expires": now + 86400,
              ":now": now,
            },
          }),
        );

        return "acquired";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "ConditionalCheckFailedException"
        )
          throw error;

        const { Item } = await db.send(
          new GetCommand({
            TableName: table,
            Key: { id },
            ConsistentRead: true,
          }),
        );

        return Item?.status === "COMPLETED" &&
          typeof Item.expiresAt === "number" &&
          Item.expiresAt > now
          ? "completed"
          : "busy";
      }
    },
    async complete(id, token, now) {
      await db.send(
        new UpdateCommand({
          TableName: table,
          Key: { id },
          UpdateExpression: "SET #s = :completed, expiresAt = :expires",
          ConditionExpression: "#t = :token",
          ExpressionAttributeNames: { "#s": "status", "#t": "token" },
          ExpressionAttributeValues: {
            ":completed": "COMPLETED",
            ":expires": now + 86400,
            ":token": token,
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
              ":pending": "PENDING",
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
