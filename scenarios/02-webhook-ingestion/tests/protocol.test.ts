import { createHmac } from "node:crypto";
import { it, expect, vi } from "vitest";
import { ingest, verify, type ReceiptStore } from "../src/protocol.js";

const now = 1767225600;

const secret = "local-fixture-secret";

const bytes = Buffer.from(
  '{"id":"event-1","type":"resource.changed","resourceId":"r1","revision":1}',
);

function signed(body: Buffer = bytes, time = now) {
  return {
    timestamp: String(time),
    signature: `v1=${createHmac("sha256", secret).update(String(time)).update(".").update(body).digest("hex")}`,
  };
}

function store(): ReceiptStore {
  return {
    claim: vi.fn<ReceiptStore["claim"]>(async () => "acquired"),
    complete: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
}

it("verifies original bytes, not reserialized JSON", () => {
  const h = signed();

  expect(verify(bytes, h.timestamp, h.signature, secret, now)).toBe(true);
  expect(
    verify(
      Buffer.concat([bytes, Buffer.from(" ")]),
      h.timestamp,
      h.signature,
      secret,
      now,
    ),
  ).toBe(false);
});

it.each(["bad", "v1=00", "v1=" + "a".repeat(64)])(
  "rejects signatures %s",
  (signature) =>
    expect(verify(bytes, String(now), signature, secret, now)).toBe(false),
);

it("rejects old and future timestamps beyond tolerance", () => {
  for (const offset of [-301, 301]) {
    const h = signed(bytes, now + offset);

    expect(verify(bytes, h.timestamp, h.signature, secret, now)).toBe(false);
  }
});

it("acknowledges only after enqueue and receipt completion", async () => {
  const s = store();
  const send = vi.fn(async () => {});

  expect(await ingest(bytes, signed(), secret, now, "t", s, send)).toBe(202);
  expect(send).toHaveBeenCalledOnce();
  expect(s.complete).toHaveBeenCalledWith("event-1", "t", now);
});

it("releases claim after failed enqueue for retry", async () => {
  const s = store();

  await expect(
    ingest(bytes, signed(), secret, now, "t", s, async () => {
      throw Error("unavailable");
    }),
  ).rejects.toThrow();
  expect(s.release).toHaveBeenCalledWith("event-1", "t");
  expect(s.complete).not.toHaveBeenCalled();
});

it("suppresses accepted replays and rejects in-flight duplicates", async () => {
  const s = store();
  const send = vi.fn();

  s.claim = async () => "completed";
  expect(await ingest(bytes, signed(), secret, now, "t", s, send)).toBe(202);
  s.claim = async () => "busy";
  expect(await ingest(bytes, signed(), secret, now, "t", s, send)).toBe(409);
  expect(send).not.toHaveBeenCalled();
});

it.each(["{", "{}"])("rejects malformed signed payload %s", async (text) => {
  const body = Buffer.from(text);

  expect(
    await ingest(body, signed(body), secret, now, "t", store(), async () => {}),
  ).toBe(text === "{" ? 400 : 422);
});
