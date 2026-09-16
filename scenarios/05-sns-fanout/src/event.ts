import { z } from "zod";

export const Change = z
  .object({
    id: z.string().min(1),
    version: z.literal(1),
    kind: z.enum(["created", "updated"]),
    resourceId: z.string().min(1),
    revision: z.number().int().positive(),
  })
  .strict();

export type Change = z.infer<typeof Change>;

export interface Publisher {
  publish(event: Change): Promise<void>;
}

export async function publish(input: unknown, publisher: Publisher) {
  const event = Change.parse(input);

  await publisher.publish(event);

  return { id: event.id, accepted: true };
}

export async function consume(
  body: string,
  record: (event: Change) => Promise<void>,
) {
  await record(Change.parse(JSON.parse(body)));
}
