import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Store } from "./worker.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export function store(table: string): Store {
  return {
    async revision(entityId) {
      const { Item } = await db.send(
        new GetCommand({
          TableName: table,
          Key: { id: entityId },
          ConsistentRead: true,
        }),
      );

      if (Item && typeof Item.revision !== "number")
        throw Error("Invalid persisted revision");

      return Item?.revision;
    },
    async save(event, data) {
      try {
        await db.send(
          new PutCommand({
            TableName: table,
            Item: {
              ...event,
              id: event.entityId,
              eventId: event.id,
              enrichment: data,
            },
            ConditionExpression:
              "attribute_not_exists(id) OR revision < :revision",
            ExpressionAttributeValues: { ":revision": event.revision },
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
  };
}
