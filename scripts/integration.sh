#!/usr/bin/env bash
set -euo pipefail
image='amazon/dynamodb-local@sha256:ff89bd48ff32cd8d9be5fee8873b65b8854dc408f1afe881be6eb00247bc0dab'
container=$(docker run --rm -d -p 127.0.0.1::8000 "$image" -jar DynamoDBLocal.jar -inMemory -sharedDb -disableTelemetry)
trap 'docker stop "$container" >/dev/null' EXIT
port=$(docker port "$container" 8000/tcp | cut -d: -f2)
export AWS_ENDPOINT_URL_DYNAMODB="http://127.0.0.1:$port"
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=local
export AWS_REGION=us-east-1
export AWS_EC2_METADATA_DISABLED=true
for attempt in $(seq 1 30); do
 if curl -s -o /dev/null "$AWS_ENDPOINT_URL_DYNAMODB"; then break; fi
 sleep 1
done
pnpm exec vitest run --config vitest.integration.config.ts
