import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { route } from "./events.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

const bus = new EventBridgeClient({ maxAttempts: 3 });

export async function handler(value: unknown) {
  return route(value, async (event) => {
    const result = await bus.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: required("BUS_NAME"),
            Source: event.source,
            DetailType: event["detail-type"],
            Detail: JSON.stringify(event.detail),
          },
        ],
      }),
    );

    if (result.FailedEntryCount || !result.Entries?.[0]?.EventId)
      throw Error("EventBridge rejected event");

    log("event_published", event.detail.id);
  });
}
