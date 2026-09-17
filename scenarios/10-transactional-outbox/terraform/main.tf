terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.64.0" }
  }
}

variable "region" { default = "us-east-1" }

variable "environment" {
  default = "dev"
  validation {
    condition     = can(regex("^[a-z0-9-]{1,12}$", var.environment))
    error_message = "Use 1-12 lowercase letters, digits or hyphens."
  }
}

variable "target_account_id" {
  type        = string
  description = "Explicitly approved sandbox account ID. The provider refuses other accounts."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id))
    error_message = "Provide the approved 12-digit AWS account ID."
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.target_account_id]
  default_tags {
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "10-transactional-outbox", ManagedBy = "Terraform" }
  }
}


locals { name = "aws-playbook-outbox-${var.environment}" }

variable "enable_workers" {
  type    = bool
  default = false
}

resource "aws_dynamodb_table" "orders" {
  name         = "${local.name}-orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
}

resource "aws_dynamodb_table" "outbox" {
  name             = "${local.name}-events"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "id"
  stream_enabled   = true
  stream_view_type = "KEYS_ONLY"
  attribute {
    name = "id"
    type = "S"
  }
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
}

module "events" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-events"
}

module "stream_failures" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-stream-failures"
}

module "create" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-create"
  artifact          = "${path.module}/../../../dist/10-transactional-outbox/create-handler.zip"
  environment       = { ORDERS_TABLE = aws_dynamodb_table.orders.name, OUTBOX_TABLE = aws_dynamodb_table.outbox.name }
  statements = [
    { actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.orders.arn, aws_dynamodb_table.outbox.arn] },
    { actions = ["dynamodb:GetItem"], resources = [aws_dynamodb_table.outbox.arn] }
  ]
}

module "dispatcher" {
  for_each          = toset(["stream", "replay"])
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-${each.key}"
  artifact          = "${path.module}/../../../dist/10-transactional-outbox/${each.key}-handler.zip"
  environment       = { ORDERS_TABLE = aws_dynamodb_table.orders.name, OUTBOX_TABLE = aws_dynamodb_table.outbox.name, QUEUE_URL = module.events.url }
  statements = concat([
    { actions = ["dynamodb:GetItem", "dynamodb:UpdateItem"], resources = [aws_dynamodb_table.outbox.arn] },
    { actions = ["sqs:SendMessage"], resources = [module.events.arn] }
    ], each.key == "stream" ? [
    { actions = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator"], resources = [aws_dynamodb_table.outbox.stream_arn] },
    { actions = ["dynamodb:ListStreams"], resources = ["*"] },
    { actions = ["sqs:SendMessage"], resources = [module.stream_failures.arn] }
  ] : [])
}

resource "aws_lambda_event_source_mapping" "outbox" {
  event_source_arn               = aws_dynamodb_table.outbox.stream_arn
  function_name                  = module.dispatcher["stream"].arn
  starting_position              = "TRIM_HORIZON"
  enabled                        = var.enable_workers
  batch_size                     = 10
  parallelization_factor         = 1
  maximum_retry_attempts         = 3
  maximum_record_age_in_seconds  = 3600
  bisect_batch_on_function_error = true
  function_response_types        = ["ReportBatchItemFailures"]
  filter_criteria {
    filter { pattern = jsonencode({ eventName = ["INSERT"] }) }
  }
  destination_config {
    on_failure { destination_arn = module.stream_failures.arn }
  }
}

output "create_function" { value = module.create.name }
output "replay_function" { value = module.dispatcher["replay"].name }
output "queue_url" { value = module.events.url }
output "outbox_table" { value = aws_dynamodb_table.outbox.name }
output "stream_failure_queue" { value = module.stream_failures.url }
