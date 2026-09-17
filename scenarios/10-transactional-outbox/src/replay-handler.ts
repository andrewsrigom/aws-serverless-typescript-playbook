import { z } from "zod";
import { publish } from "./adapters.js";

const schema = z.strictObject({
  eventId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
});

export async function handler(input: unknown) {
  const { eventId } = schema.parse(input);

  await publish(eventId);

  return { eventId, status: "PUBLISHED" };
}
