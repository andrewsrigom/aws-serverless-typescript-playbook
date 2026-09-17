import { store } from "./adapters.js";

export async function handler(input: unknown) {
  return store().create(input);
}
