import { Enrichment } from "./event.js";

export class ProviderError extends Error {
  constructor(readonly retryable: boolean) {
    super("Provider request failed");
  }
}

export async function enrich(
  entityId: string,
  url: string,
  fetcher: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => number = Math.random,
): Promise<Enrichment> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(
        `${url}/classify/${encodeURIComponent(entityId)}`,
        { signal: AbortSignal.timeout(1000) },
      );

      if (!response.ok)
        throw new ProviderError(
          response.status === 429 || response.status >= 500,
        );

      return Enrichment.parse(await response.json());
    } catch (error) {
      const retry =
        error instanceof ProviderError
          ? error.retryable
          : error instanceof Error &&
            ["TimeoutError", "AbortError", "TypeError"].includes(error.name);

      if (!retry || attempt === 2) throw error;

      await sleep(Math.floor(random() * Math.min(100 * 2 ** attempt, 400)));
    }
  }

  throw Error("Retry budget exhausted");
}
