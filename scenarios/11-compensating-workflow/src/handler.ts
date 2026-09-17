import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { reservations, requestSchema } from "./reservations.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

const taskSchema = z.strictObject({
  action: z.enum(["reserve", "confirm", "compensate"]),
  input: requestSchema,
});

export async function handler(input: unknown) {
  const task = taskSchema.parse(input);
  const store = reservations(db, required("TABLE_NAME"));
  const result = await store[task.action](task.input);

  log(`reservation_${result.status.toLowerCase()}`, task.input.id);

  return result;
}
