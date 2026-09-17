import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { Hash } from "@smithy/hash-node";
import { SignatureV4 } from "@smithy/signature-v4";

type Credentials = ConstructorParameters<typeof SignatureV4>[0]["credentials"];

export function iamProviderFetch(
  endpoint: string,
  region: string,
  credentials: Credentials = fromNodeProviderChain(),
  fetcher: typeof fetch = fetch,
): typeof fetch {
  const allowed = new URL(endpoint);

  if (
    allowed.protocol !== "https:" ||
    allowed.username ||
    allowed.password ||
    allowed.search ||
    allowed.hash ||
    allowed.pathname !== "/"
  ) {
    throw Error("Provider endpoint must be an HTTPS origin");
  }

  const signer = new SignatureV4({
    service: "execute-api",
    region,
    credentials,
    sha256: Hash.bind(null, "sha256"),
  });

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);

    if (
      url.origin !== allowed.origin ||
      !/^\/classify\/[a-zA-Z0-9_-]{1,100}$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (input instanceof Request && input.method !== "GET") ||
      (init?.method && init.method !== "GET") ||
      init?.body
    ) {
      throw Error("Refusing to sign an unexpected provider request");
    }

    const signed = await signer.sign({
      protocol: url.protocol,
      hostname: url.hostname,
      ...(url.port ? { port: Number(url.port) } : {}),
      path: url.pathname,
      method: "GET",
      headers: { host: url.host },
    });

    return fetcher(url, {
      ...init,
      method: "GET",
      headers: signed.headers,
      redirect: "error",
    });
  };
}
