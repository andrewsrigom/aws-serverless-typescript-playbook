import { it, expect } from "vitest";
import { reconcile, type Store } from "../src/reconcile.js";

it("checkpoints every successful page and resumes bounded work", async () => {
  let cursor: string | undefined;
  const completed: string[] = [];
  const s: Store = {
    async checkpoint() {
      return cursor;
    },
    async page(key) {
      return key ? { ids: ["b"] } : { ids: ["a"], cursor: "next" };
    },
    async reconcile(id) {
      completed.push(id);
    },
    async save(key) {
      cursor = key;
    },
  };

  expect(await reconcile(s, 1)).toEqual({ processed: 1, more: true });
  expect(cursor).toBe("next");
  expect(await reconcile(s, 1)).toEqual({ processed: 1, more: false });
  expect(completed).toEqual(["a", "b"]);
  expect(cursor).toBeUndefined();
});

it("does not advance checkpoint after partial failure and safely repeats completed work", async () => {
  let fail = true;
  let cursor: string | undefined;
  const completed = new Set<string>();
  const s: Store = {
    async checkpoint() {
      return cursor;
    },
    async page() {
      return { ids: ["a", "b"] };
    },
    async reconcile(id) {
      if (id === "b" && fail) throw Error("failure");

      completed.add(id);
    },
    async save(next) {
      cursor = next;
    },
  };

  await expect(reconcile(s)).rejects.toThrow();
  expect(cursor).toBeUndefined();
  fail = false;
  await reconcile(s);
  expect([...completed]).toEqual(["a", "b"]);
});

it("continues after a filtered empty page with a cursor", async () => {
  let pages = 0;
  const s: Store = {
    async checkpoint() {
      return undefined;
    },
    async page() {
      return ++pages === 1 ? { ids: [], cursor: "next" } : { ids: ["b"] };
    },
    async reconcile() {},
    async save() {},
  };

  expect(await reconcile(s)).toEqual({ processed: 1, more: false });
});
