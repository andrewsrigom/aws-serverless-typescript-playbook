#!/usr/bin/env bash
set -euo pipefail
terraform_bin="${TERRAFORM_BIN:-terraform}"
if ! command -v "$terraform_bin" >/dev/null 2>&1 && test -x .tools/terraform; then
  terraform_bin="$PWD/.tools/terraform"
fi
"$terraform_bin" fmt -check -recursive terraform scenarios
for directory in scenarios/*/terraform; do
  "$terraform_bin" -chdir="$directory" init -backend=false -input=false
  "$terraform_bin" -chdir="$directory" validate
done
