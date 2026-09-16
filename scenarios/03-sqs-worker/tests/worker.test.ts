import { it, expect, vi } from "vitest";
import { processJob } from "../src/worker.js";
import { processBatch } from "../../../lib/batch.js";
import type { SQSEvent } from "aws-lambda";

function event(bodies: string[]): SQSEvent {
  return {
    Records: bodies.map((body, index) => ({
      messageId: String(index),
      body,
      receiptHandle: "fixture",
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

it("reports poison and downstream failures without retrying successes", async () => {
  const record = vi.fn(async (id: string) => {
    if (id === "unavailable") throw Error("timeout");
  });

  expect(
    await processBatch(
      event([
        '{"id":"ok","quantity":1}',
        "bad",
        '{"id":"unavailable","quantity":1}',
        '{"id":"negative","quantity":-1}',
      ]),
      (body) => processJob(body, { record }),
    ),
  ).toEqual({
    batchItemFailures: [
      { itemIdentifier: "1" },
      { itemIdentifier: "2" },
      { itemIdentifier: "3" },
    ],
  });
  expect(record).toHaveBeenCalledTimes(2);
});

it("handles an empty batch", async () =>
  expect(await processBatch(event([]), async () => {})).toEqual({
    batchItemFailures: [],
  }));

it("allows repeated replacement writes for duplicate delivery", async () => {
  const items = new Map();
  const store = {
    async record(id: string, quantity: number) {
      items.set(id, quantity);
    },
  };

  await processJob('{"id":"a","quantity":2}', store);
  await processJob('{"id":"a","quantity":2}', store);
  expect(items.size).toBe(1);
});
