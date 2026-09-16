import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { execute } from "./resource.js";
import { dynamoStore } from "./store.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const correlationId = event.requestContext.requestId;

  try {
    const result = await execute(
      {
        method: event.requestContext.http.method,
        ...(event.pathParameters?.id ? { id: event.pathParameters.id } : {}),
        ...(event.body !== undefined
          ? {
              body: event.isBase64Encoded
                ? Buffer.from(event.body, "base64").toString("utf8")
                : event.body,
            }
          : {}),
      },
      dynamoStore(required("TABLE_NAME")),
    );

    log("http_request", correlationId, { statusCode: result.statusCode });

    return {
      statusCode: result.statusCode,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify(result.body),
    };
  } catch {
    log("http_failure", correlationId);

    return {
      statusCode: 503,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ error: "temporarily_unavailable" }),
    };
  }
}
