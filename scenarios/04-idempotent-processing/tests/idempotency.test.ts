import { it, expect, vi } from "vitest";
import {
  once,
  BusyError,
  ConflictError,
  type Store,
  type Entry,
} from "../src/idempotency.js";

function memory(): Store & { entries: Map<string, Entry> } {
  const entries = new Map<string, Entry>();

  return {
    entries,
    async acquire(entry, now) {
      const old = entries.get(entry.id);

      if (
        old &&
        old.expiresAt > now &&
        !(
          old.status === "IN_PROGRESS" &&
          old.leaseUntil <= now &&
          old.fingerprint === entry.fingerprint
        )
      )
        return false;

      entries.set(entry.id, entry);

      return true;
    },
    async read(id) {
      return entries.get(id);
    },
    async complete(id, token, result, now) {
      const e = entries.get(id);

      if (!e || e.token !== token || e.leaseUntil <= now)
        throw Error("lost lease");

      entries.set(id, { ...e, status: "COMPLETED", result });
    },
    async release(id, token) {
      if (entries.get(id)?.token === token) entries.delete(id);
    },
  };
}

it("reuses completed results and rejects identity payload collisions", async () => {
  const s = memory();
  const work = vi.fn(async () => "RESULT");

  expect(await once("a", "body", s, work, () => 100)).toBe("RESULT");
  expect(await once("a", "body", s, work, () => 101)).toBe("RESULT");
  expect(work).toHaveBeenCalledOnce();
  await expect(
    once("a", "different", s, work, () => 101),
  ).rejects.toBeInstanceOf(ConflictError);
});

it("allows only one concurrent owner", async () => {
  const s = memory();
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  const first = once(
    "a",
    "same",
    s,
    async () => {
      await held;

      return "ok";
    },
    () => 100,
  );

  await expect(
    once(
      "a",
      "same",
      s,
      async () => "bad",
      () => 100,
    ),
  ).rejects.toBeInstanceOf(BusyError);
  release();
  await expect(first).resolves.toBe("ok");
});

it("recovers after failure, stale lease, and expiry before TTL deletion", async () => {
  const s = memory();

  await expect(
    once(
      "a",
      "same",
      s,
      async () => {
        throw Error("failure");
      },
      () => 100,
    ),
  ).rejects.toThrow("failure");
  expect(s.entries.size).toBe(0);
  await once(
    "a",
    "same",
    s,
    async () => "first",
    () => 100,
  );

  const e = s.entries.get("a");

  if (!e) throw Error("fixture");

  s.entries.set("a", { ...e, status: "IN_PROGRESS", leaseUntil: 90 });
  expect(
    await once(
      "a",
      "same",
      s,
      async () => "recovered",
      () => 100,
    ),
  ).toBe("recovered");
  expect(
    await once(
      "a",
      "new",
      s,
      async () => "expired",
      () => 100000,
    ),
  ).toBe("expired");
});

it("cannot finalize after its lease expires", async () => {
  const s = memory();
  let now = 100;

  await expect(
    once(
      "a",
      "same",
      s,
      async () => {
        now = 161;

        return "late";
      },
      () => now,
    ),
  ).rejects.toThrow("lost lease");
});
