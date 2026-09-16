import {
  SQSClient,
  ReceiveMessageCommand,
  SendMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import type { QueuePort } from "./replay.js";

const sqs = new SQSClient({ maxAttempts: 3 });

export const queues: QueuePort = {
  async receive(queue, limit, dryRun) {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queue,
        MaxNumberOfMessages: limit,
        VisibilityTimeout: dryRun ? 0 : 60,
        WaitTimeSeconds: 1,
        MessageAttributeNames: ["All"],
      }),
    );

    return (result.Messages ?? []).map((message) => {
      if (
        !message.MessageId ||
        !message.ReceiptHandle ||
        message.Body === undefined
      )
        throw Error("Incomplete SQS message");

      const attributes: Record<
        string,
        { DataType: string; StringValue: string }
      > = {};

      for (const [key, value] of Object.entries(
        message.MessageAttributes ?? {},
      )) {
        if (value.BinaryValue || !value.StringValue || !value.DataType)
          throw Error(
            "Binary or incomplete message attributes require a custom replay adapter",
          );

        attributes[key] = {
          DataType: value.DataType,
          StringValue: value.StringValue,
        };
      }

      return {
        id: message.MessageId,
        receipt: message.ReceiptHandle,
        body: message.Body,
        attributes,
      };
    });
  },
  async publish(queue, message) {
    if (
      Object.keys(message.attributes).length >= 10 &&
      !message.attributes.replaySourceMessageId
    )
      throw Error("No attribute slot available for replay provenance");

    const result = await sqs.send(
      new SendMessageCommand({
        QueueUrl: queue,
        MessageBody: message.body,
        MessageAttributes: {
          ...message.attributes,
          replaySourceMessageId: {
            DataType: "String",
            StringValue:
              message.attributes.replaySourceMessageId?.StringValue ??
              message.id,
          },
        },
      }),
    );

    if (!result.MessageId) throw Error("Publish did not return a message ID");

    return result.MessageId;
  },
  async remove(queue, receipt) {
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: queue, ReceiptHandle: receipt }),
    );
  },
};
