import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { publish } from "./event.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

const sns = new SNSClient({ maxAttempts: 3 });

export async function handler(input: unknown) {
  return publish(input, {
    async publish(event) {
      await sns.send(
        new PublishCommand({
          TopicArn: required("TOPIC_ARN"),
          Message: JSON.stringify(event),
          MessageAttributes: {
            kind: { DataType: "String", StringValue: event.kind },
          },
        }),
      );
      log("fanout_published", event.id);
    },
  });
}
