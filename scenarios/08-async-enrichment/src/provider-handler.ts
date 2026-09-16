import type { APIGatewayProxyEventV2 } from "aws-lambda";

export async function handler(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id;

  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    return { statusCode: 400, body: '{"error":"invalid_id"}' };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: id.length > 8 ? "extended" : "standard",
      providerVersion: "simulator-v1",
    }),
  };
}
