import { Event, type Enrichment } from "./event.js";

export interface Store {
  revision(entityId: string): Promise<number | undefined>;
  save(event: Event, data: Enrichment): Promise<boolean>;
}

export async function processEvent(
  body: string,
  store: Store,
  provider: (id: string) => Promise<Enrichment>,
) {
  const event = Event.parse(JSON.parse(body));
  const revision = await store.revision(event.entityId);

  if (revision !== undefined && revision >= event.revision) return "ignored";

  const data = await provider(event.entityId);

  return (await store.save(event, data)) ? "saved" : "superseded";
}
