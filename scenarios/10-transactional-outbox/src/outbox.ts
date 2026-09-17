import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export const orderSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  quantity: z.number().int().min(1).max(100),
});

export type Order = z.infer<typeof orderSchema>;

export function outboxStore(
  db: DynamoDBDocumentClient,
  orders: string,
  outbox: string,
) {
  async function load(id: string) {
    const result = await db.send(
      new GetCommand({ TableName: outbox, Key: { id }, ConsistentRead: true }),
    );

    if (!result.Item) throw new Error("OutboxEventNotFound");

    return z
      .object({
        id: z.string(),
        payload: orderSchema,
        digest: z.string(),
        status: z.enum(["PENDING", "PUBLISHED"]),
      })
      .parse(result.Item);
  }

  return {
    load,
    async create(value: unknown) {
      const order = orderSchema.parse(value);
      const digest = createHash("sha256")
        .update(JSON.stringify(order))
        .digest("hex");

      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: orders,
                  Item: { ...order, status: "CREATED" },
                  ConditionExpression: "attribute_not_exists(id)",
                },
              },
              {
                Put: {
                  TableName: outbox,
                  Item: {
                    id: order.id,
                    payload: order,
                    digest,
                    status: "PENDING",
                  },
                  ConditionExpression: "attribute_not_exists(id)",
                },
              },
            ],
          }),
        );

        return { id: order.id, duplicate: false };
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "TransactionCanceledException"
        )
          throw error;

        const existing = await load(order.id);

        if (existing.digest !== digest)
          throw new Error("IdempotencyConflict", { cause: error });

        return { id: order.id, duplicate: true };
      }
    },
    async markPublished(id: string) {
      await db.send(
        new UpdateCommand({
          TableName: outbox,
          Key: { id },
          UpdateExpression: "SET #status = :published",
          ConditionExpression: "attribute_exists(id)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":published": "PUBLISHED" },
        }),
      );
    },
  };
}

export async function dispatch(
  id: string,
  store: Pick<ReturnType<typeof outboxStore>, "load" | "markPublished">,
  send: (order: Order) => Promise<void>,
) {
  const event = await store.load(id);

  if (event.status === "PUBLISHED") return;

  // A crash after send and before this update can publish twice. Keep the stable business ID.
  await send(event.payload);
  await store.markPublished(id);
}
