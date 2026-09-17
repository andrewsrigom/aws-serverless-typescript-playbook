import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { required } from "../../../lib/env.js";
import { policy, uploadRequest } from "./upload.js";

const s3 = new S3Client({ maxAttempts: 3 });

export async function handler(input: unknown) {
  uploadRequest.parse(input);

  const id = randomUUID();
  const options = policy(required("BUCKET_NAME"), id);
  const form = await createPresignedPost(s3, options);

  return { uploadId: id, expiresInSeconds: options.Expires, ...form };
}
