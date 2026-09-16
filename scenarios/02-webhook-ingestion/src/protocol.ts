import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const Webhook = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    type: z.literal("resource.changed"),
    resourceId: z.string().min(1).max(100),
    revision: z.number().int().positive(),
  })
  .strict();

export function verify(
  bytes: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
  now: number,
): boolean {
  if (
    !/^\d{10}$/.test(timestamp) ||
    !/^v1=[a-f0-9]{64}$/.test(signature) ||
    Math.abs(now - Number(timestamp)) > 300 ||
    bytes.length > 64 * 1024
  )
    return false;

  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(bytes)
    .digest();

  return timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"));
}

export interface ReceiptStore {
  claim(
    id: string,
    token: string,
    now: number,
  ): Promise<"acquired" | "completed" | "busy">;
  complete(id: string, token: string, now: number): Promise<void>;
  release(id: string, token: string): Promise<void>;
}

export async function ingest(
  bytes: Buffer,
  headers: { timestamp: string; signature: string },
  secret: string,
  now: number,
  token: string,
  store: ReceiptStore,
  enqueue: (body: string) => Promise<void>,
): Promise<number> {
  if (!verify(bytes, headers.timestamp, headers.signature, secret, now))
    return 401;

  let value: unknown;

  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return 400;
  }

  const result = Webhook.safeParse(value);

  if (!result.success) return 422;

  const claim = await store.claim(result.data.id, token, now);

  if (claim === "completed") return 202;

  if (claim === "busy") return 409;

  try {
    await enqueue(bytes.toString("utf8"));
    await store.complete(result.data.id, token, now);

    return 202;
  } catch (error) {
    await store.release(result.data.id, token);

    throw error;
  }
}
