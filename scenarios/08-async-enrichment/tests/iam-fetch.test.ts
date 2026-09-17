import { it, expect, vi } from "vitest";
import { iamProviderFetch } from "../src/iam-fetch.js";

const endpoint = "https://example.execute-api.us-east-1.amazonaws.com";
const credentials = {
  accessKeyId: "LOCAL_FIXTURE",
  secretAccessKey: "local-fixture",
  sessionToken: "fixture-session",
};

it("signs execute-api requests using temporary credentials and retains the deadline", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
  const signal = AbortSignal.timeout(1000);
  const signedFetch = iamProviderFetch(
    endpoint,
    "us-east-1",
    credentials,
    fetcher,
  );

  await signedFetch(endpoint + "/classify/item-1", { signal });
  const init = fetcher.mock.calls[0]?.[1];
  const headers = new Headers(init?.headers);

  expect(headers.get("authorization")).toContain(
    "/us-east-1/execute-api/aws4_request",
  );
  expect(headers.get("x-amz-security-token")).toBe("fixture-session");
  expect(init?.signal).toBe(signal);
  expect(init?.redirect).toBe("error");
});

it("refuses other origins, unexpected paths, and insecure transport before resolving credentials", async () => {
  const resolve = vi.fn(async () => credentials);
  const fetcher = vi.fn<typeof fetch>();
  const signedFetch = iamProviderFetch(endpoint, "us-east-1", resolve, fetcher);

  await expect(
    signedFetch("https://other.invalid/classify/item"),
  ).rejects.toThrow();
  await expect(signedFetch(endpoint + "/admin")).rejects.toThrow();
  await expect(signedFetch(endpoint + "/classify/item?x=y")).rejects.toThrow();
  expect(() =>
    iamProviderFetch("http://example.invalid", "us-east-1", credentials),
  ).toThrow();
  await expect(
    signedFetch(new Request(endpoint + "/classify/item", { method: "POST" })),
  ).rejects.toThrow();
  expect(resolve).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
