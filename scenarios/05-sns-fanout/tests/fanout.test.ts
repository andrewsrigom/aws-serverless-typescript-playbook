import { it, expect, vi } from "vitest";
import { publish, consume } from "../src/event.js";

const event = {
  id: "e1",
  version: 1,
  kind: "created",
  resourceId: "r1",
  revision: 1,
};

it("publishes validated versioned events", async () => {
  const send = vi.fn(async () => {});

  expect(await publish(event, { publish: send })).toEqual({
    id: "e1",
    accepted: true,
  });
  expect(send).toHaveBeenCalledWith(event);
});

it("rejects incompatible versions before publishing", async () => {
  const send = vi.fn();

  await expect(
    publish({ ...event, version: 2 }, { publish: send }),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it("independent consumer failures do not change the other result", async () => {
  const healthy = vi.fn(async () => {});
  const outcomes = await Promise.allSettled([
    consume(JSON.stringify(event), healthy),
    consume(JSON.stringify(event), async () => {
      throw Error("unavailable");
    }),
  ]);

  expect(outcomes.map((x) => x.status)).toEqual(["fulfilled", "rejected"]);
  expect(healthy).toHaveBeenCalledOnce();
});
