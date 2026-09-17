import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { outboxStore } from "../src/outbox.js";

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB;

if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1")
  throw Error("Integration tests require loopback DynamoDB Local endpoint");

const client = new DynamoDBClient({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
  maxAttempts: 3,
});

const db = DynamoDBDocumentClient.from(client);

const table = `playbook-local-${randomUUID()}`;

beforeAll(async () => {
  for (const name of [table, `${table}-outbox`]) {
    await client.send(
      new CreateTableCommand({
        TableName: name,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
      }),
    );
    await waitUntilTableExists(
      { client, maxWaitTime: 15, minDelay: 1, maxDelay: 2 },
      { TableName: name },
    );
  }
});

afterAll(async () => {
  for (const name of [table, `${table}-outbox`])
    await client.send(new DeleteTableCommand({ TableName: name }));
  client.destroy();
});

it("atomically persists order and event, deduplicates retries and rejects changed payloads", async () => {
  const store = outboxStore(db, table, `${table}-outbox`);
  const order = { id: "order-one", quantity: 2 };

  expect(await store.create(order)).toEqual({ id: order.id, duplicate: false });
  expect(await store.create(order)).toEqual({ id: order.id, duplicate: true });
  await expect(store.create({ ...order, quantity: 3 })).rejects.toThrow(
    "IdempotencyConflict",
  );
  expect(
    (
      await db.send(
        new GetCommand({
          TableName: table,
          Key: { id: order.id },
          ConsistentRead: true,
        }),
      )
    ).Item?.quantity,
  ).toBe(2);
  expect((await store.load(order.id)).status).toBe("PENDING");
});

it("does not persist an order when the outbox condition fails", async () => {
  const store = outboxStore(db, table, `${table}-outbox`);

  await db.send(
    new PutCommand({
      TableName: `${table}-outbox`,
      Item: {
        id: "collision",
        digest: "different",
        payload: { id: "collision", quantity: 3 },
        status: "PENDING",
      },
    }),
  );
  await expect(store.create({ id: "collision", quantity: 1 })).rejects.toThrow(
    "IdempotencyConflict",
  );
  expect(
    (
      await db.send(
        new GetCommand({
          TableName: table,
          Key: { id: "collision" },
          ConsistentRead: true,
        }),
      )
    ).Item,
  ).toBeUndefined();
});

it("retains the full event for manual recovery and records publication", async () => {
  const store = outboxStore(db, table, `${table}-outbox`);

  await store.create({ id: "recovery", quantity: 4 });
  await store.markPublished("recovery");
  expect(await store.load("recovery")).toMatchObject({
    payload: { id: "recovery", quantity: 4 },
    status: "PUBLISHED",
  });
});
