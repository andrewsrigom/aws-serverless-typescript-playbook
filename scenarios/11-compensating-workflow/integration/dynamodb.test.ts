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
import { reservations, requestSchema } from "../src/reservations.js";

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
  for (const name of [table]) {
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
  for (const name of [table])
    await client.send(new DeleteTableCommand({ TableName: name }));
  client.destroy();
});

async function setup(id: string) {
  const request = requestSchema.parse({ id, sku: id, quantity: 2 });

  await db.send(
    new PutCommand({
      TableName: table,
      Item: { id: `stock#${id}`, available: 10 },
    }),
  );

  return { request, store: reservations(db, table) };
}

async function available(sku: string) {
  return (
    await db.send(
      new GetCommand({
        TableName: table,
        Key: { id: `stock#${sku}` },
        ConsistentRead: true,
      }),
    )
  ).Item?.available;
}

it("repeated reservation and confirmation consume stock once", async () => {
  const { request, store } = await setup("success");

  await store.reserve(request);
  await store.reserve(request);
  await store.confirm(request);
  await store.confirm(request);
  expect(await available(request.sku)).toBe(8);
  expect(await store.compensate(request)).toEqual({ status: "COMPLETED" });
  expect(await available(request.sku)).toBe(8);
});

it("failed fulfillment refunds stock exactly once under concurrent compensation", async () => {
  const { request: original, store } = await setup("failure");
  const request = { ...original, simulateFailure: true };

  await store.reserve(request);
  await expect(store.confirm(request)).rejects.toThrow("FulfillmentRejected");
  const results = await Promise.all([
    store.compensate(request),
    store.compensate(request),
  ]);

  expect(results).toEqual([
    { status: "COMPENSATED" },
    { status: "COMPENSATED" },
  ]);
  expect(await available(request.sku)).toBe(10);
  await expect(store.reserve(request)).rejects.toThrow("ReservationRejected");
});

it("a compensation tombstone prevents a late reservation", async () => {
  const { request, store } = await setup("late");

  await store.compensate(request);
  await expect(store.reserve(request)).rejects.toThrow("ReservationRejected");
  expect(await available(request.sku)).toBe(10);
});

it("confirmation racing compensation cannot both consume and refund stock", async () => {
  const { request, store } = await setup("race");

  await store.reserve(request);
  await Promise.allSettled([store.confirm(request), store.compensate(request)]);
  const result = await store.compensate(request);

  expect(await available(request.sku)).toBe(
    result.status === "COMPLETED" ? 8 : 10,
  );
});

it("rejects reused IDs with changed quantities without refunding other stock", async () => {
  const { request, store } = await setup("conflict");

  await store.reserve(request);
  await expect(store.compensate({ ...request, quantity: 3 })).rejects.toThrow(
    "IdempotencyConflict",
  );
  expect(await available(request.sku)).toBe(8);
});

it("insufficient stock cannot create a reservation or inflate stock on compensation", async () => {
  const { request, store } = await setup("empty");

  await db.send(
    new PutCommand({
      TableName: table,
      Item: { id: `stock#${request.sku}`, available: 1 },
    }),
  );
  await expect(store.reserve(request)).rejects.toThrow("ReservationRejected");
  await store.compensate(request);
  expect(await available(request.sku)).toBe(1);
});
