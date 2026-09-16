import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { dynamoStore } from "../src/store.js";
import { once, type Entry } from "../src/idempotency.js";

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB;

if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1")
  throw Error("Integration tests require loopback DynamoDB Local endpoint");

const client = new DynamoDBClient({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const db = DynamoDBDocumentClient.from(client);

const table = `playbook-local-${randomUUID()}`;

beforeAll(async () => {
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    }),
  );
  await waitUntilTableExists(
    { client, maxWaitTime: 15, minDelay: 1, maxDelay: 2 },
    { TableName: table },
  );
});

afterAll(async () => {
  await client.send(new DeleteTableCommand({ TableName: table }));
  client.destroy();
});

it("DynamoDB conditional acquisition has exactly one winner", async () => {
  const store = dynamoStore(table);
  const entry: Entry = {
    id: "race",
    fingerprint: "same",
    status: "IN_PROGRESS",
    token: "first",
    leaseUntil: 160,
    expiresAt: 200,
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      store.acquire({ ...entry, token: String(index) }, 100),
    ),
  );

  expect(results.filter(Boolean)).toHaveLength(1);
});

it("expired items can be replaced before TTL deletes them and old tokens cannot complete", async () => {
  const store = dynamoStore(table);
  const entry: Entry = {
    id: "expiry",
    fingerprint: "old",
    status: "COMPLETED",
    token: "old",
    leaseUntil: 80,
    expiresAt: 99,
    result: "old",
  };

  await db.send(new PutCommand({ TableName: table, Item: entry }));
  expect(
    await once(
      "expiry",
      "new",
      store,
      async () => "new",
      () => 100,
    ),
  ).toBe("new");
  await expect(
    store.complete("expiry", "old", "incorrect", 100),
  ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
  expect((await store.read("expiry"))?.result).toBe("new");
});

it("recovers a failed attempt and persists the result", async () => {
  const store = dynamoStore(table);

  await expect(
    once(
      "recovery",
      "same",
      store,
      async () => {
        throw Error("downstream");
      },
      () => 100,
    ),
  ).rejects.toThrow("downstream");
  expect(
    await once(
      "recovery",
      "same",
      store,
      async () => "recovered",
      () => 101,
    ),
  ).toBe("recovered");
});

it("an expired lease can be reacquired but the replaced owner cannot finalize", async () => {
  const store = dynamoStore(table);
  const old: Entry = {
    id: "lease",
    fingerprint: "same",
    status: "IN_PROGRESS",
    token: "old",
    leaseUntil: 99,
    expiresAt: 200,
  };

  await db.send(new PutCommand({ TableName: table, Item: old }));
  expect(
    await store.acquire({ ...old, token: "new", leaseUntil: 160 }, 100),
  ).toBe(true);
  await expect(
    store.complete("lease", "old", "wrong", 100),
  ).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
  await store.release("lease", "old");
  expect((await store.read("lease"))?.token).toBe("new");
});
