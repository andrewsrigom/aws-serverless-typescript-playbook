import { afterEach, it, expect, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { handler } from "../src/process-handler.js";

const { s3Send, dbSend } = vi.hoisted(() => ({
  s3Send: vi.fn<(command: { input: unknown }) => Promise<unknown>>(),
  dbSend: vi.fn<(command: { input: unknown }) => Promise<unknown>>(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();

  return {
    ...actual,
    S3Client: class {
      send = s3Send;
    },
  };
});

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();

  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send: dbSend }) },
  };
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function event(bodies: string[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({
      body,
      messageId: String(index),
      receiptHandle: "receipt",
      attributes: {
        ApproximateReceiveCount: "1",
        SentTimestamp: "0",
        SenderId: "fixture",
        ApproximateFirstReceiveTimestamp: "0",
      },
      messageAttributes: {},
      md5OfBody: "fixture",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:fixture",
      awsRegion: "us-east-1",
    })),
  };
}

const object = {
  key: "incoming/a1234567-1234-1234-1234-123456789abc.json",
  versionId: "immutable-version",
  size: 44,
};

const notification = JSON.stringify({
  Records: [
    {
      eventSource: "aws:s3",
      eventName: "ObjectCreated:Post",
      s3: { bucket: { name: "sandbox" }, object },
    },
  ],
});

it("acknowledges a valid version while reporting a poison message separately", async () => {
  vi.stubEnv("BUCKET_NAME", "sandbox");
  vi.stubEnv("TABLE_NAME", "results");
  const read = s3Send.mockResolvedValue({
    ContentLength: 44,
    ContentType: "application/json",
    Body: {
      transformToByteArray: async () =>
        Buffer.from('{"records":[{"id":"one","quantity":2}]}'),
    },
  });
  const put = dbSend.mockResolvedValue({});

  expect(await handler(event(["invalid json", notification]))).toEqual({
    batchItemFailures: [{ itemIdentifier: "0" }],
  });
  expect(read.mock.calls[0]?.[0].input).toEqual({
    Bucket: "sandbox",
    Key: object.key,
    VersionId: object.versionId,
  });
  expect(put.mock.calls[0]?.[0].input).toMatchObject({
    TableName: "results",
    ConditionExpression: "attribute_not_exists(id)",
    Item: { recordCount: 1, totalQuantity: 2, version: object.versionId },
  });
});

it("acknowledges duplicates only on the conditional-write conflict", async () => {
  vi.stubEnv("BUCKET_NAME", "sandbox");
  vi.stubEnv("TABLE_NAME", "results");
  s3Send.mockResolvedValue({
    ContentLength: 44,
    ContentType: "application/json",
    Body: {
      transformToByteArray: async () =>
        Buffer.from('{"records":[{"id":"one","quantity":2}]}'),
    },
  });
  const duplicate = new Error("duplicate");
  duplicate.name = "ConditionalCheckFailedException";
  const put = dbSend
    .mockRejectedValueOnce(duplicate)
    .mockRejectedValueOnce(Error("unavailable"));

  expect(await handler(event([notification, notification]))).toEqual({
    batchItemFailures: [{ itemIdentifier: "1" }],
  });
  expect(put).toHaveBeenCalledTimes(2);
});

it("cancels oversized response bodies before buffering and never writes a result", async () => {
  vi.stubEnv("BUCKET_NAME", "sandbox");
  const cancel = vi.fn().mockResolvedValue(undefined);
  const bytes = vi.fn();
  s3Send.mockResolvedValue({
    ContentLength: 2 * 1024 * 1024,
    ContentType: "application/json",
    Body: {
      transformToWebStream: () => ({ cancel }),
      transformToByteArray: bytes,
    },
  });
  const put = dbSend.mockResolvedValue({});

  expect(await handler(event([notification]))).toEqual({
    batchItemFailures: [{ itemIdentifier: "0" }],
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(bytes).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it("retries S3 read failures without persisting partial summaries", async () => {
  vi.stubEnv("BUCKET_NAME", "sandbox");
  s3Send.mockRejectedValue(Error("timeout"));
  const put = dbSend.mockResolvedValue({});

  expect(await handler(event([notification]))).toEqual({
    batchItemFailures: [{ itemIdentifier: "0" }],
  });
  expect(put).not.toHaveBeenCalled();
});
