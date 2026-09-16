import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ingest } from "./protocol.js";
import { receipts } from "./receipts.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

const secrets = new SecretsManagerClient({ maxAttempts: 2 });

const sqs = new SQSClient({ maxAttempts: 2 });

export async function handler(event: APIGatewayProxyEventV2) {
  const correlationId = event.requestContext.requestId;

  try {
    const { SecretString } = await secrets.send(
      new GetSecretValueCommand({ SecretId: required("SECRET_ARN") }),
    );

    if (!SecretString) throw new Error("Missing signing secret");

    const bytes = Buffer.from(
      event.body ?? "",
      event.isBase64Encoded ? "base64" : "utf8",
    );
    const statusCode = await ingest(
      bytes,
      {
        timestamp: event.headers["x-playbook-timestamp"] ?? "",
        signature: event.headers["x-playbook-signature"] ?? "",
      },
      SecretString,
      Math.floor(Date.now() / 1000),
      correlationId,
      receipts(required("TABLE_NAME")),
      async (body) => {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: required("QUEUE_URL"),
            MessageBody: body,
            MessageAttributes: {
              correlationId: { DataType: "String", StringValue: correlationId },
            },
          }),
        );
      },
    );

    log("webhook_received", correlationId, { statusCode });

    return {
      statusCode,
      body: JSON.stringify({ accepted: statusCode === 202 }),
    };
  } catch {
    log("webhook_unavailable", correlationId);

    return { statusCode: 503, body: '{"error":"temporarily_unavailable"}' };
  }
}
