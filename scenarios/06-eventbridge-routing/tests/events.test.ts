import { it, expect, vi } from "vitest";
import { route } from "../src/events.js";

const event = {
  source: "playbook.resources",
  "detail-type": "resource.created.v1",
  detail: { id: "e1", schemaVersion: 1, resourceId: "r1", revision: 1 },
};

it("accepts versioned domain event", async () => {
  const send = vi.fn(async () => {});

  await route(event, send);
  expect(send).toHaveBeenCalledWith(event);
});

it.each([
  { ...event, source: "unknown" },
  { ...event, "detail-type": "resource.created.v2" },
  { ...event, detail: { ...event.detail, schemaVersion: 2 } },
])(
  "rejects invalid routing contract",
  async (invalid) =>
    await expect(route(invalid, async () => {})).rejects.toThrow(),
);

it("propagates downstream errors to trigger retry", async () =>
  await expect(
    route(event, async () => {
      throw Error("publish failed");
    }),
  ).rejects.toThrow("publish failed"));
