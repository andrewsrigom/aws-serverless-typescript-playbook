import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Event } from "./event.js";
import { required } from "../../../lib/env.js";

const sqs = new SQSClient({ maxAttempts: 3 });

export async function handler(input: unknown) {
  const event = Event.parse(input);

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: required("QUEUE_URL"),
      MessageBody: JSON.stringify(event),
    }),
  );

  return { accepted: true, id: event.id };
}
