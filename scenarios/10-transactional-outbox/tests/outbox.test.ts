import { it, expect, vi } from "vitest";
import { dispatch, orderSchema } from "../src/outbox.js";
import { processStream } from "../src/stream.js";

function store(status: "PENDING" | "PUBLISHED" = "PENDING") {
  return {
    load: vi.fn().mockResolvedValue({
      id: "order-1",
      payload: { id: "order-1", quantity: 2 },
      digest: "digest",
      status,
    }),
    markPublished: vi.fn().mockResolvedValue(undefined),
  };
}

it("publishes before marking and preserves identity", async () => {
  const repository = store();
  const send = vi.fn(async () => {
    expect(repository.markPublished).not.toHaveBeenCalled();
  });

  await dispatch("order-1", repository, send);

  expect(send).toHaveBeenCalledWith({ id: "order-1", quantity: 2 });
  expect(repository.markPublished).toHaveBeenCalledWith("order-1");
});

it("keeps failed sends pending", async () => {
  const repository = store();

  await expect(
    dispatch("order-1", repository, async () => {
      throw Error("timeout");
    }),
  ).rejects.toThrow("timeout");
  expect(repository.markPublished).not.toHaveBeenCalled();
});

it("allows safe consumer deduplication after an ambiguous publication", async () => {
  const repository = store();
  const send = vi.fn().mockResolvedValue(undefined);
  repository.markPublished.mockRejectedValueOnce(Error("database unavailable"));

  await expect(dispatch("order-1", repository, send)).rejects.toThrow();
  await dispatch("order-1", repository, send);

  expect(send.mock.calls).toEqual([
    [{ id: "order-1", quantity: 2 }],
    [{ id: "order-1", quantity: 2 }],
  ]);
});

it("skips an already published event", async () => {
  const send = vi.fn();

  await dispatch("order-1", store("PUBLISHED"), send);

  expect(send).not.toHaveBeenCalled();
});

it("returns the first failing stream sequence and stops the batch", async () => {
  const publish = vi.fn().mockRejectedValueOnce(Error("queue unavailable"));

  expect(
    await processStream(
      {
        Records: [
          { eventName: "MODIFY", dynamodb: { SequenceNumber: "9" } },
          {
            eventName: "INSERT",
            dynamodb: { Keys: { id: { S: "one" } }, SequenceNumber: "10" },
          },
          {
            eventName: "INSERT",
            dynamodb: { Keys: { id: { S: "two" } }, SequenceNumber: "11" },
          },
        ],
      },
      publish,
    ),
  ).toEqual({ batchItemFailures: [{ itemIdentifier: "10" }] });
  expect(publish).toHaveBeenCalledTimes(1);
});

it("rejects malformed orders before persistence", () => {
  expect(orderSchema.safeParse({ id: "one", quantity: 0 }).success).toBe(false);
  expect(
    orderSchema.safeParse({ id: "one", quantity: 1, secret: "unwanted" })
      .success,
  ).toBe(false);
});
