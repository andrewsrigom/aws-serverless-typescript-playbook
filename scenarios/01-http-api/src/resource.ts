import { z } from "zod";

export const Resource = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(120),
});

export type Resource = z.infer<typeof Resource>;

export interface ResourceStore {
  create(resource: Resource): Promise<boolean>;
  get(id: string): Promise<Resource | undefined>;
}

export interface Request {
  method: string;
  id?: string;
  body?: string;
}

export async function execute(request: Request, store: ResourceStore) {
  if (request.method === "POST" && request.id === undefined) {
    let input: unknown;

    try {
      input = JSON.parse(request.body ?? "");
    } catch {
      return { statusCode: 400, body: { error: "invalid_json" } };
    }

    const parsed = Resource.safeParse(input);

    if (!parsed.success)
      return { statusCode: 422, body: { error: "invalid_resource" } };

    return (await store.create(parsed.data))
      ? { statusCode: 201, body: parsed.data }
      : { statusCode: 409, body: { error: "already_exists" } };
  }

  if (request.method === "GET" && request.id !== undefined) {
    if (!Resource.shape.id.safeParse(request.id).success)
      return { statusCode: 400, body: { error: "invalid_id" } };

    const resource = await store.get(request.id);

    return resource
      ? { statusCode: 200, body: resource }
      : { statusCode: 404, body: { error: "not_found" } };
  }

  return { statusCode: 405, body: { error: "method_not_allowed" } };
}
