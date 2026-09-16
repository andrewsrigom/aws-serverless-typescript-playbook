import { parseArgs } from "node:util";
import { replay } from "./replay.js";
import { queues } from "./queue.js";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    destination: { type: "string" },
    limit: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});

if (!values.source || !values.destination || !values.limit)
  throw Error(
    "Required: --source URL --destination URL --limit 1..100; dry-run unless --apply",
  );

console.log(
  JSON.stringify(
    await replay(
      {
        source: values.source,
        destination: values.destination,
        limit: Number(values.limit),
        apply: values.apply,
      },
      queues,
    ),
    null,
    2,
  ),
);
