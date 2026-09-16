import { it, expect, vi } from "vitest";
import { enrich } from "../src/provider.js";
import { processEvent, type Store } from "../src/worker.js";

const data = { category: "standard", providerVersion: "simulator-v1" } as const;

it("retries transient failures with bounded jitter", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(new Response("", { status: 429 }))
    .mockResolvedValueOnce(Response.json(data));
  const sleep = vi.fn(async () => {});

  expect(
    await enrich("e1", "https://provider.invalid", fetcher, sleep, () => 0.5),
  ).toEqual(data);
  expect(sleep.mock.calls).toEqual([[50], [100]]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("stops after three timeouts and provides an abort signal", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.signal).toBeDefined();

    throw new DOMException("deadline", "TimeoutError");
  });

  await expect(
    enrich(
      "e1",
      "https://provider.invalid",
      fetcher,
      async () => {},
      () => 0,
    ),
  ).rejects.toThrow("deadline");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not retry permanent HTTP errors or invalid provider data", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response("", { status: 400 }),
  );

  await expect(
    enrich("e1", "https://provider.invalid", fetcher),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(
    enrich("e1", "https://provider.invalid", async () =>
      Response.json({ category: "invented" }),
    ),
  ).rejects.toThrow();
});

it("ignores duplicate and older revisions and conditionally persists concurrent results", async () => {
  let revision = 2;
  const provider = vi.fn(async () => data);
  const store: Store = {
    async revision() {
      return revision;
    },
    async save(event) {
      if (event.revision <= revision) return false;

      revision = event.revision;

      return true;
    },
  };
  const body = (n: number) =>
    JSON.stringify({
      id: `e${n}`,
      entityId: "item",
      revision: n,
      schemaVersion: 1,
    });

  expect(await processEvent(body(2), store, provider)).toBe("ignored");
  expect(await processEvent(body(1), store, provider)).toBe("ignored");
  expect(provider).not.toHaveBeenCalled();
  expect(await processEvent(body(3), store, provider)).toBe("saved");
  expect(
    await processEvent(body(4), store, async () => {
      revision = 5;

      return data;
    }),
  ).toBe("superseded");
});
