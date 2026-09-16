import type { Context } from "aws-lambda";
import { reconcile } from "./reconcile.js";
import { store } from "./store.js";
import { required } from "../../../lib/env.js";
import { log } from "../../../lib/log.js";

export async function handler(_event: unknown, context: Context) {
  const result = await reconcile(
    store(required("TABLE_NAME"), required("CHECKPOINT_TABLE")),
  );

  log("reconciliation_finished", context.awsRequestId, result);

  return result;
}
