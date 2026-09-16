import { createHash, randomUUID } from "node:crypto";

export interface Entry {
  id: string;
  fingerprint: string;
  status: "IN_PROGRESS" | "COMPLETED";
  token: string;
  leaseUntil: number;
  expiresAt: number;
  result?: string;
}

export interface Store {
  acquire(entry: Entry, now: number): Promise<boolean>;
  read(id: string): Promise<Entry | undefined>;
  complete(
    id: string,
    token: string,
    result: string,
    now: number,
  ): Promise<void>;
  release(id: string, token: string): Promise<void>;
}

export class BusyError extends Error {}

export class ConflictError extends Error {}

export async function once(
  id: string,
  payload: string,
  store: Store,
  work: () => Promise<string>,
  now: () => number = () => Math.floor(Date.now() / 1000),
): Promise<string> {
  const time = now();
  const token = randomUUID();
  const fingerprint = createHash("sha256").update(payload).digest("hex");
  const acquired = await store.acquire(
    {
      id,
      fingerprint,
      status: "IN_PROGRESS",
      token,
      leaseUntil: time + 60,
      expiresAt: time + 86400,
    },
    time,
  );

  if (!acquired) {
    const previous = await store.read(id);

    if (
      previous &&
      previous.expiresAt > time &&
      previous.fingerprint !== fingerprint
    )
      throw new ConflictError("Identity reused with a different payload");

    if (
      previous?.status === "COMPLETED" &&
      previous.expiresAt > time &&
      previous.result !== undefined
    )
      return previous.result;

    throw new BusyError("Another attempt owns the lease");
  }

  try {
    const result = await work();

    await store.complete(id, token, result, now());

    return result;
  } catch (error) {
    await store.release(id, token);

    throw error;
  }
}
