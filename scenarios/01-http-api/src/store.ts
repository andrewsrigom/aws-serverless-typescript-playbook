import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource, type ResourceStore } from "./resource.js";

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ maxAttempts: 3 }),
);

export function dynamoStore(table: string): ResourceStore {
  return {
    async create(resource) {
      try {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: resource,
            ConditionExpression: "attribute_not_exists(id)",
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
    async get(id) {
      const { Item } = await client.send(
        new GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }),
      );

      return Item ? Resource.parse(Item) : undefined;
    },
  };
}
