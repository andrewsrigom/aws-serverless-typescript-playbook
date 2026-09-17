import type { DynamoDBStreamEvent } from "aws-lambda";
import { publish } from "./adapters.js";
import { processStream } from "./stream.js";

export async function handler(event: DynamoDBStreamEvent) {
  return processStream(event, publish);
}
