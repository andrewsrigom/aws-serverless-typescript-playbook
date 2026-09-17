import { it, expect, vi } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { readFileSync } from "node:fs";
import { reservations, requestSchema } from "../src/reservations.js";

const request = requestSchema.parse({ id: "one", sku: "widget", quantity: 2 });

it("rejects invalid quantities and unexpected task data", () => {
  expect(requestSchema.safeParse({ ...request, quantity: 0 }).success).toBe(
    false,
  );
  expect(requestSchema.safeParse({ ...request, quantity: 11 }).success).toBe(
    false,
  );
  expect(requestSchema.safeParse({ ...request, token: "secret" }).success).toBe(
    false,
  );
});

it("rejects simulated fulfillment before a write", async () => {
  const db = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: "us-east-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  const send = vi.spyOn(db, "send");

  await expect(
    reservations(db, "table").confirm({ ...request, simulateFailure: true }),
  ).rejects.toThrow("FulfillmentRejected");
  expect(send).not.toHaveBeenCalled();
});

it("routes failed reservations and confirmations to bounded compensation", () => {
  const workflow = JSON.parse(
    readFileSync(new URL("../workflow.asl.json", import.meta.url), "utf8"),
  );

  expect(workflow.TimeoutSeconds).toBe(300);
  for (const name of ["Reserve", "Confirm", "Compensate"]) {
    const task = workflow.States[name];

    expect(task.TimeoutSeconds).toBe(20);
    expect(task.Retry[0].MaxAttempts).toBe(2);
    expect(task.Catch[0].Next).toBe(
      name === "Compensate" ? "ManualReview" : "Compensate",
    );
    expect(task.Parameters["input.$"]).toBe("$.request");
  }
  expect(workflow.States.CompensationResult.Choices[0].Next).toBe("Completed");
  expect(workflow.States.Compensated.Type).toBe("Fail");
  expect(workflow.States.ManualReview.Type).toBe("Fail");
});
