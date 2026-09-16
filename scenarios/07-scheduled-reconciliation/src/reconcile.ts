export interface Page {
  ids: string[];
  cursor?: string;
}

export interface Store {
  checkpoint(): Promise<string | undefined>;
  page(cursor: string | undefined): Promise<Page>;
  reconcile(id: string): Promise<void>;
  save(cursor: string | undefined): Promise<void>;
}

export async function reconcile(store: Store, maxPages = 5) {
  let cursor = await store.checkpoint();
  let processed = 0;

  for (let page = 0; page < maxPages; page++) {
    const result = await store.page(cursor);

    for (const id of result.ids) {
      await store.reconcile(id);
      processed++;
    }

    await store.save(result.cursor);
    cursor = result.cursor;

    if (cursor === undefined) break;
  }

  return { processed, more: cursor !== undefined };
}
