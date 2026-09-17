import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { ingest, validEnvelope } from "./protocol.js";
import { cachedSecret } from "./secret.js";
import { receipts } from "./receipts.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

const secrets = new SecretsManagerClient({ maxAttempts: 2 });

const sqs = new SQSClient({ maxAttempts: 2 });

const signingSecret = cachedSecret(async () => {
  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: required("SECRET_ARN") }),
  );

  if (!SecretString) throw Error("Missing signing secret");

  return SecretString;
});

export async function handler(event: APIGatewayProxyEventV2) {
  const correlationId = event.requestContext.requestId;

  try {
    const bytes = Buffer.from(
      event.body ?? "",
      event.isBase64Encoded ? "base64" : "utf8",
    );
    const timestamp = event.headers["x-playbook-timestamp"] ?? "";
    const signature = event.headers["x-playbook-signature"] ?? "";
    const now = Math.floor(Date.now() / 1000);

    if (!validEnvelope(bytes, timestamp, signature, now)) {
      return { statusCode: 401, body: '{"accepted":false}' };
    }

    const SecretString = await signingSecret();

    const statusCode = await ingest(
      bytes,
      {
        timestamp,
        signature,
      },
      SecretString,
      now,
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
