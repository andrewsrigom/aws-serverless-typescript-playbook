import type { PresignedPostOptions } from "@aws-sdk/s3-presigned-post";
import { z } from "zod";

export const maxBytes = 1024 * 1024;

export const uploadRequest = z.strictObject({
  contentType: z.literal("application/json"),
});

export const documentSchema = z
  .strictObject({
    records: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
          quantity: z.number().int().min(1).max(100),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (value) =>
      new Set(value.records.map((record) => record.id)).size ===
      value.records.length,
    "Duplicate record IDs",
  );

const notificationSchema = z.object({
  Records: z
    .array(
      z.object({
        eventSource: z.literal("aws:s3"),
        eventName: z.literal("ObjectCreated:Post"),
        s3: z.object({
          bucket: z.object({ name: z.string() }),
          object: z.object({
            key: z.string(),
            versionId: z.string().min(1),
            size: z.number().int().min(1).max(maxBytes),
          }),
        }),
      }),
    )
    .min(1)
    .max(10),
});

export function policy(bucket: string, id: string): PresignedPostOptions {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("InvalidUploadId");

  return {
    Bucket: bucket,
    Key: `incoming/${id}.json`,
    Expires: 60,
    Fields: {
      "Content-Type": "application/json",
      "x-amz-server-side-encryption": "AES256",
    },
    Conditions: [
      ["content-length-range", 1, maxBytes],
      { "Content-Type": "application/json" },
      { "x-amz-server-side-encryption": "AES256" },
    ],
  };
}

export function parseNotifications(body: string, bucket: string) {
  const value: unknown = JSON.parse(body);

  // S3 sends this control event when Terraform configures the notification.
  if (
    z
      .object({
        Event: z.literal("s3:TestEvent"),
        Bucket: z.literal(bucket),
        Service: z.literal("Amazon S3"),
      })
      .safeParse(value).success
  )
    return [];

  return notificationSchema.parse(value).Records.map((record) => {
    const key = decodeURIComponent(record.s3.object.key.replaceAll("+", " "));

    if (
      record.s3.bucket.name !== bucket ||
      !/^incoming\/[0-9a-f-]{36}\.json$/.test(key) ||
      record.s3.object.versionId === "null"
    ) {
      throw new Error("UnexpectedUploadObject");
    }

    return { key, version: record.s3.object.versionId };
  });
}

export function summarize(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.length > maxBytes)
    throw new Error("InvalidUploadSize");

  const document = documentSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );

  return {
    recordCount: document.records.length,
    totalQuantity: document.records.reduce(
      (sum, record) => sum + record.quantity,
      0,
    ),
  };
}
