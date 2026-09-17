import { it, expect, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { handler } from "../src/handler.js";

it("rejects malformed envelopes without calling paid AWS APIs", async () => {
  const secret = vi.spyOn(SecretsManagerClient.prototype, "send");
  const queue = vi.spyOn(SQSClient.prototype, "send");
  const database = vi.spyOn(DynamoDBDocumentClient.prototype, "send");
  const event: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: "POST /webhook",
    rawPath: "/webhook",
    rawQueryString: "",
    headers: {},
    body: "{}",
    isBase64Encoded: false,
    requestContext: {
      accountId: "123456789012",
      apiId: "fixture",
      domainName: "fixture.invalid",
      domainPrefix: "fixture",
      http: {
        method: "POST",
        path: "/webhook",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "unit-test",
      },
      requestId: "fixture",
      routeKey: "POST /webhook",
      stage: "$default",
      time: "fixture",
      timeEpoch: 0,
    },
  };

  try {
    expect(await handler(event)).toEqual({
      statusCode: 401,
      body: '{"accepted":false}',
    });
    expect(secret).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});
