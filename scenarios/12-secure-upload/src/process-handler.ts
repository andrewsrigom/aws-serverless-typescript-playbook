import { createHash } from "node:crypto";
import type { SQSEvent } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { processBatch } from "../../../lib/batch.js";
import { required } from "../../../lib/env.js";
import { maxBytes, parseNotifications, summarize } from "./upload.js";

const s3 = new S3Client({ maxAttempts: 3 });

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 3 }));

export async function handler(event: SQSEvent) {
  return processBatch(event, async (body) => {
    const bucket = required("BUCKET_NAME");

    for (const object of parseNotifications(body, bucket)) {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: object.key,
          VersionId: object.version,
        }),
      );

      if (!response.Body) throw new Error("MissingObjectBody");

      if (
        !response.ContentLength ||
        response.ContentLength > maxBytes ||
        response.ContentType !== "application/json"
      ) {
        await response.Body.transformToWebStream().cancel();

        throw new Error("InvalidUploadMetadata");
      }

      // S3 supplies ContentLength; the selected immutable version is bounded before buffering.
      const summary = summarize(await response.Body.transformToByteArray());
      const id = createHash("sha256")
        .update(JSON.stringify([bucket, object.key, object.version]))
        .digest("hex");

      try {
        await db.send(
          new PutCommand({
            TableName: required("TABLE_NAME"),
            Item: {
              id,
              ...object,
              ...summary,
              expiresAt: Math.floor(Date.now() / 1000) + 86400,
            },
            ConditionExpression: "attribute_not_exists(id)",
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "ConditionalCheckFailedException"
        )
          throw error;
      }
    }
  });
}
