import { createServer } from "node:http";
import { it, expect } from "vitest";
import { enrich } from "../src/provider.js";

it("aborts real local HTTP requests when the provider exceeds the deadline", async () => {
  const server = createServer((_request, response) => {
    response.on("close", () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (!address || typeof address === "string") throw Error("No bound port");

  try {
    await expect(
      enrich(
        "r1",
        `http://127.0.0.1:${address.port}`,
        fetch,
        async () => {},
        () => 0,
      ),
    ).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
