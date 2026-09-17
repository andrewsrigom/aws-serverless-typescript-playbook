import { z } from "zod";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export const requestSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sku: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  quantity: z.number().int().min(1).max(10),
  simulateFailure: z.boolean().default(false),
});

const reservationSchema = requestSchema.extend({
  status: z.enum(["RESERVED", "COMPLETED", "COMPENSATED"]),
});

export type Request = z.infer<typeof requestSchema>;

function conditional(error: unknown) {
  return (
    error instanceof Error &&
    [
      "ConditionalCheckFailedException",
      "TransactionCanceledException",
    ].includes(error.name)
  );
}

export function reservations(db: DynamoDBDocumentClient, table: string) {
  async function read(request: Request) {
    const result = await db.send(
      new GetCommand({
        TableName: table,
        Key: { id: `reservation#${request.id}` },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) return undefined;

    const existing = reservationSchema.parse({
      ...result.Item,
      id: request.id,
    });

    if (
      existing.sku !== request.sku ||
      existing.quantity !== request.quantity ||
      existing.simulateFailure !== request.simulateFailure
    ) {
      throw new Error("IdempotencyConflict");
    }

    return existing;
  }

  return {
    async reserve(request: Request) {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: table,
                  Key: { id: `stock#${request.sku}` },
                  UpdateExpression: "SET available = available - :quantity",
                  ConditionExpression: "available >= :quantity",
                  ExpressionAttributeValues: { ":quantity": request.quantity },
                },
              },
              {
                Put: {
                  TableName: table,
                  Item: {
                    ...request,
                    id: `reservation#${request.id}`,
                    status: "RESERVED",
                  },
                  ConditionExpression: "attribute_not_exists(id)",
                },
              },
            ],
          }),
        );

        return { status: "RESERVED" };
      } catch (error) {
        if (!conditional(error)) throw error;

        const existing = await read(request);

        if (!existing || existing.status === "COMPENSATED")
          throw new Error("ReservationRejected", { cause: error });

        return { status: existing.status };
      }
    },
    async confirm(request: Request) {
      // This scenario simulates fulfillment locally; it does not charge a payment provider.
      if (request.simulateFailure) throw new Error("FulfillmentRejected");

      try {
        await db.send(
          new UpdateCommand({
            TableName: table,
            Key: { id: `reservation#${request.id}` },
            UpdateExpression: "SET #status = :completed",
            ConditionExpression:
              "#status = :reserved AND sku = :sku AND quantity = :quantity AND simulateFailure = :failure",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":completed": "COMPLETED",
              ":reserved": "RESERVED",
              ":sku": request.sku,
              ":quantity": request.quantity,
              ":failure": request.simulateFailure,
            },
          }),
        );

        return { status: "COMPLETED" };
      } catch (error) {
        if (!conditional(error)) throw error;

        const existing = await read(request);

        if (existing?.status === "COMPLETED") return { status: "COMPLETED" };

        throw new Error("ConfirmationRejected", { cause: error });
      }
    },
    async compensate(request: Request) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await read(request);

        if (
          existing?.status === "COMPLETED" ||
          existing?.status === "COMPENSATED"
        )
          return { status: existing.status };

        try {
          if (!existing) {
            // A tombstone blocks a delayed reserve after an ambiguous invocation timeout.
            await db.send(
              new PutCommand({
                TableName: table,
                Item: {
                  ...request,
                  id: `reservation#${request.id}`,
                  status: "COMPENSATED",
                },
                ConditionExpression: "attribute_not_exists(id)",
              }),
            );
          } else {
            await db.send(
              new TransactWriteCommand({
                TransactItems: [
                  {
                    Update: {
                      TableName: table,
                      Key: { id: `reservation#${request.id}` },
                      UpdateExpression: "SET #status = :compensated",
                      ConditionExpression: "#status = :reserved",
                      ExpressionAttributeNames: { "#status": "status" },
                      ExpressionAttributeValues: {
                        ":compensated": "COMPENSATED",
                        ":reserved": "RESERVED",
                      },
                    },
                  },
                  {
                    Update: {
                      TableName: table,
                      Key: { id: `stock#${request.sku}` },
                      UpdateExpression: "SET available = available + :quantity",
                      ConditionExpression: "attribute_exists(available)",
                      ExpressionAttributeValues: {
                        ":quantity": request.quantity,
                      },
                    },
                  },
                ],
              }),
            );
          }

          return { status: "COMPENSATED" };
        } catch (error) {
          if (!conditional(error)) throw error;
        }
      }

      throw new Error("CompensationNeedsReview");
    },
  };
}
