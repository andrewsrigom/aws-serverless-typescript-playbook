import { it, expect, vi } from "vitest";
import { cachedSecret } from "../src/secret.js";
import { validEnvelope } from "../src/protocol.js";

it("coalesces concurrent loads and refreshes after one minute", async () => {
  let now = 0;
  const load = vi.fn(async () => "key");
  const read = cachedSecret(load, () => now);

  expect(await Promise.all([read(), read(), read()])).toEqual([
    "key",
    "key",
    "key",
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  now = 59_999;
  await read();
  expect(load).toHaveBeenCalledTimes(1);
  now = 60_000;
  await read();
  expect(load).toHaveBeenCalledTimes(2);
});

it("does not retain a failed or empty secret load", async () => {
  const load = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(Error("unavailable"))
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("rotated");
  const read = cachedSecret(load);

  await expect(read()).rejects.toThrow("unavailable");
  await expect(read()).rejects.toThrow("Missing signing secret");
  await expect(read()).resolves.toBe("rotated");
});

it("rejects oversized, expired, and malformed envelopes before secret access", () => {
  const timestamp = 1767225600;
  const signature = "v1=" + "a".repeat(64);

  expect(
    validEnvelope(Buffer.alloc(65536), String(timestamp), signature, timestamp),
  ).toBe(true);
  expect(
    validEnvelope(Buffer.alloc(65537), String(timestamp), signature, timestamp),
  ).toBe(false);
  expect(
    validEnvelope(
      Buffer.from("{}"),
      String(timestamp),
      signature,
      timestamp + 301,
    ),
  ).toBe(false);
  expect(
    validEnvelope(Buffer.from("{}"), String(timestamp), "bad", timestamp),
  ).toBe(false);
});
