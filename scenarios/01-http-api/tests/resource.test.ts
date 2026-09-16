import { describe, it, expect } from "vitest";
import { execute, type Resource, type ResourceStore } from "../src/resource.js";

function memory(): ResourceStore {
  const items = new Map<string, Resource>();

  return {
    async create(item) {
      if (items.has(item.id)) return false;

      items.set(item.id, item);

      return true;
    },
    async get(id) {
      return items.get(id);
    },
  };
}

describe("resource API", () => {
  it("creates, reads and rejects duplicate IDs", async () => {
    const store = memory();
    const request = {
      method: "POST",
      body: '{"id":"note-1","title":"Read patterns"}',
    };

    expect((await execute(request, store)).statusCode).toBe(201);
    expect(await execute({ method: "GET", id: "note-1" }, store)).toEqual({
      statusCode: 200,
      body: { id: "note-1", title: "Read patterns" },
    });
    expect((await execute(request, store)).statusCode).toBe(409);
  });
  it.each([
    ["{", 400],
    ["null", 422],
    ['{"id":"a","title":" "}', 422],
  ])("rejects malformed input %s", async (body, status) => {
    expect((await execute({ method: "POST", body }, memory())).statusCode).toBe(
      status,
    );
  });
  it("handles missing resource, invalid ID and unsupported method", async () => {
    expect(
      (await execute({ method: "GET", id: "missing" }, memory())).statusCode,
    ).toBe(404);
    expect(
      (await execute({ method: "GET", id: "../" }, memory())).statusCode,
    ).toBe(400);
    expect((await execute({ method: "DELETE" }, memory())).statusCode).toBe(
      405,
    );
  });
  it("has one winner for concurrent creates", async () => {
    const store = memory();
    const results = await Promise.all(
      [1, 2].map(() =>
        execute({ method: "POST", body: '{"id":"a","title":"A"}' }, store),
      ),
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });
});
