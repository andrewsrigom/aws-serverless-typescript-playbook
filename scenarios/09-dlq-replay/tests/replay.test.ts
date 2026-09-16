import { it, expect, vi } from "vitest";
import { replay, type QueuePort } from "../src/replay.js";

const options = {
  source: "https://sqs.us-east-1.amazonaws.com/123456789012/dlq",
  destination: "https://sqs.us-east-1.amazonaws.com/123456789012/work",
  limit: 1,
  apply: false,
};

function port(): QueuePort {
  return {
    receive: vi.fn(async () => [
      {
        id: "s1",
        receipt: "receipt",
        body: '{"id":"business-1"}',
        attributes: {},
      },
    ]),
    publish: vi.fn(async () => "p1"),
    remove: vi.fn(async () => {}),
  };
}

it("dry-runs without republishing or deleting", async () => {
  const p = port();

  expect(await replay(options, p)).toEqual([
    { sourceMessageId: "s1", action: "would_replay" },
  ]);
  expect(p.publish).not.toHaveBeenCalled();
  expect(p.remove).not.toHaveBeenCalled();
});

it("publishes before deleting and preserves identity", async () => {
  const p = port();

  await replay({ ...options, apply: true }, p);
  expect(p.publish).toHaveBeenCalledWith(
    options.destination,
    expect.objectContaining({ body: '{"id":"business-1"}' }),
  );
  expect(vi.mocked(p.publish).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(p.remove).mock.invocationCallOrder[0] ?? 0,
  );
});

it("does not delete on publish failure", async () => {
  const p = port();

  p.publish = async () => {
    throw Error("timeout");
  };
  await expect(replay({ ...options, apply: true }, p)).rejects.toThrow();
  expect(p.remove).not.toHaveBeenCalled();
});

it.each([0, 101, 1.2])(
  "rejects unsafe limit %s",
  async (limit) =>
    await expect(replay({ ...options, limit }, port())).rejects.toThrow(),
);

it("rejects same source and destination", async () =>
  await expect(
    replay({ ...options, destination: options.source }, port()),
  ).rejects.toThrow());
