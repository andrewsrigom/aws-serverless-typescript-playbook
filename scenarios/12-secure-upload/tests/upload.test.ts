import { it, expect } from "vitest";
import {
  policy,
  parseNotifications,
  summarize,
  maxBytes,
  uploadRequest,
} from "../src/upload.js";

const id = "a1234567-1234-1234-1234-123456789abc";

const record = {
  eventSource: "aws:s3",
  eventName: "ObjectCreated:Post",
  s3: {
    bucket: { name: "sandbox" },
    object: { key: `incoming/${id}.json`, versionId: "version-one", size: 40 },
  },
};

it("bounds the signed form's size, type, destination and lifetime", () => {
  expect(policy("sandbox", id)).toEqual({
    Bucket: "sandbox",
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
  });
  expect(uploadRequest.safeParse({ contentType: "text/html" }).success).toBe(
    false,
  );
  expect(
    uploadRequest.safeParse({
      contentType: "application/json",
      key: "arbitrary",
    }).success,
  ).toBe(false);
});

it("pins notification processing to the exact object version", () => {
  expect(
    parseNotifications(JSON.stringify({ Records: [record] }), "sandbox"),
  ).toEqual([{ key: `incoming/${id}.json`, version: "version-one" }]);
});

it("rejects oversized objects, unversioned events, and other buckets", () => {
  expect(() =>
    parseNotifications(JSON.stringify({ Records: [record] }), "other"),
  ).toThrow();
  for (const object of [
    { ...record.s3.object, size: maxBytes + 1 },
    { ...record.s3.object, versionId: "null" },
    { ...record.s3.object, key: "incoming/../secret" },
  ]) {
    expect(() =>
      parseNotifications(
        JSON.stringify({
          Records: [{ ...record, s3: { ...record.s3, object } }],
        }),
        "sandbox",
      ),
    ).toThrow();
  }
});

it("acknowledges the S3 setup test without fetching an object", () => {
  expect(
    parseNotifications(
      JSON.stringify({
        Event: "s3:TestEvent",
        Bucket: "sandbox",
        Service: "Amazon S3",
      }),
      "sandbox",
    ),
  ).toEqual([]);
});

it("summarizes a validated document without persisting its contents", () => {
  expect(
    summarize(
      Buffer.from(
        JSON.stringify({
          records: [
            { id: "one", quantity: 2 },
            { id: "two", quantity: 3 },
          ],
        }),
      ),
    ),
  ).toEqual({ recordCount: 2, totalQuantity: 5 });
});

it.each([
  "bad json",
  JSON.stringify({ records: [] }),
  JSON.stringify({
    records: [
      { id: "one", quantity: 2 },
      { id: "one", quantity: 3 },
    ],
  }),
])("rejects poison documents: %s", (body) => {
  expect(() => summarize(Buffer.from(body))).toThrow();
});

it("rejects excessive size and invalid UTF-8", () => {
  expect(() => summarize(new Uint8Array(maxBytes + 1))).toThrow(
    "InvalidUploadSize",
  );
  expect(() => summarize(Uint8Array.from([255]))).toThrow();
});
