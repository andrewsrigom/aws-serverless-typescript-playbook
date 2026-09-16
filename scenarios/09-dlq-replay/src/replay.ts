export interface Message {
  id: string;
  receipt: string;
  body: string;
  attributes: Record<string, { DataType: string; StringValue: string }>;
}

export interface QueuePort {
  receive(queue: string, limit: number, dryRun: boolean): Promise<Message[]>;
  publish(queue: string, message: Message): Promise<string>;
  remove(queue: string, receipt: string): Promise<void>;
}

export interface Options {
  source: string;
  destination: string;
  limit: number;
  apply: boolean;
}

export function validate(options: Options): void {
  const url =
    /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[a-zA-Z0-9_-]+$/;

  if (
    !url.test(options.source) ||
    !url.test(options.destination) ||
    options.source === options.destination ||
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 100
  )
    throw Error(
      "Select distinct standard SQS queues and an integer limit from 1 to 100",
    );
}

export async function replay(options: Options, port: QueuePort) {
  validate(options);

  let remaining = options.limit;
  const seen = new Set<string>();
  const results: {
    sourceMessageId: string;
    publishedMessageId?: string;
    action: string;
  }[] = [];

  while (remaining > 0) {
    const batch = await port.receive(
      options.source,
      Math.min(remaining, 10),
      !options.apply,
    );

    if (!batch.length) break;

    let fresh = 0;

    for (const message of batch) {
      if (seen.has(message.id)) continue;

      seen.add(message.id);
      fresh++;
      remaining--;

      if (options.apply) {
        const publishedMessageId = await port.publish(
          options.destination,
          message,
        );

        await port.remove(options.source, message.receipt);
        results.push({
          sourceMessageId: message.id,
          publishedMessageId,
          action: "replayed",
        });
      } else
        results.push({ sourceMessageId: message.id, action: "would_replay" });
    }

    if (fresh === 0) break;
  }

  return results;
}
