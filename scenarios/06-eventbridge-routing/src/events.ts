import { z } from "zod";

export const Detail = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(1),
    resourceId: z.string().min(1),
    revision: z.number().int().positive(),
  })
  .strict();

export const DomainEvent = z.object({
  source: z.literal("playbook.resources"),
  "detail-type": z.enum(["resource.created.v1", "resource.deleted.v1"]),
  detail: Detail,
});

export type DomainEvent = z.infer<typeof DomainEvent>;

export async function route(
  value: unknown,
  send: (event: DomainEvent) => Promise<void>,
) {
  const event = DomainEvent.parse(value);

  await send(event);

  return { accepted: true, id: event.detail.id };
}
