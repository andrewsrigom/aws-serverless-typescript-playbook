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
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "06-eventbridge-routing", ManagedBy = "Terraform" }
  }
}

locals { name = "aws-playbook-routing-${var.environment}" }

resource "aws_cloudwatch_event_bus" "events" { name = local.name }

module "publisher" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-publisher"
  artifact          = "${path.module}/../../../dist/06-eventbridge-routing/publisher-handler.zip"
  environment       = { BUS_NAME = aws_cloudwatch_event_bus.events.name }
  statements        = [{ actions = ["events:PutEvents"], resources = [aws_cloudwatch_event_bus.events.arn] }]
  timeout           = 15
}

resource "aws_dynamodb_table" "created" {
  name         = "${local.name}-created"
  billing_mode = "PAY_PER_REQUEST"
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
  hash_key = "id"
  attribute {
    name = "id"
    type = "S"
  }
}

module "created" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-created"
  visibility        = 90
  publishers        = [{ service = "events.amazonaws.com", source_arn = aws_cloudwatch_event_rule.created.arn }]
}

module "created_consumer" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-created"
  artifact          = "${path.module}/../../../dist/06-eventbridge-routing/consumer-handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.created.name, EXPECTED_TYPE = "resource.created.v1" }
  statements        = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.created.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.created.arn] }]
  timeout           = 15
}

resource "aws_lambda_event_source_mapping" "created" {
  event_source_arn                   = module.created.arn
  function_name                      = module.created_consumer.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  enabled                            = var.enable_workers
  scaling_config { maximum_concurrency = 2 }
}

resource "aws_cloudwatch_event_rule" "created" {
  name           = "${local.name}-created"
  event_bus_name = aws_cloudwatch_event_bus.events.name
  event_pattern  = jsonencode({ source = ["playbook.resources"], "detail-type" = ["resource.created.v1"], detail = { schemaVersion = [1] } })
}

resource "aws_cloudwatch_event_target" "created" {
  event_bus_name = aws_cloudwatch_event_bus.events.name
  rule           = aws_cloudwatch_event_rule.created.name
  arn            = module.created.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }
  dead_letter_config { arn = module.created.dlq_arn }
}

output "created_queue_url" { value = module.created.url }

output "created_dlq_url" { value = module.created.dlq_url }

output "created_table_name" { value = aws_dynamodb_table.created.name }

resource "aws_dynamodb_table" "deleted" {
  name         = "${local.name}-deleted"
  billing_mode = "PAY_PER_REQUEST"
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
  hash_key = "id"
  attribute {
    name = "id"
    type = "S"
  }
}

module "deleted" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-deleted"
  visibility        = 90
  publishers        = [{ service = "events.amazonaws.com", source_arn = aws_cloudwatch_event_rule.deleted.arn }]
}

module "deleted_consumer" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-deleted"
  artifact          = "${path.module}/../../../dist/06-eventbridge-routing/consumer-handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.deleted.name, EXPECTED_TYPE = "resource.deleted.v1" }
  statements        = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.deleted.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.deleted.arn] }]
  timeout           = 15
}

resource "aws_lambda_event_source_mapping" "deleted" {
  event_source_arn                   = module.deleted.arn
  function_name                      = module.deleted_consumer.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  enabled                            = var.enable_workers
  scaling_config { maximum_concurrency = 2 }
}

resource "aws_cloudwatch_event_rule" "deleted" {
  name           = "${local.name}-deleted"
  event_bus_name = aws_cloudwatch_event_bus.events.name
  event_pattern  = jsonencode({ source = ["playbook.resources"], "detail-type" = ["resource.deleted.v1"], detail = { schemaVersion = [1] } })
}

resource "aws_cloudwatch_event_target" "deleted" {
  event_bus_name = aws_cloudwatch_event_bus.events.name
  rule           = aws_cloudwatch_event_rule.deleted.name
  arn            = module.deleted.arn
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }
  dead_letter_config { arn = module.deleted.dlq_arn }
}

output "deleted_queue_url" { value = module.deleted.url }

output "deleted_dlq_url" { value = module.deleted.dlq_url }

output "deleted_table_name" { value = aws_dynamodb_table.deleted.name }

output "publisher_function_name" { value = module.publisher.name }

output "bus_name" { value = aws_cloudwatch_event_bus.events.name }

variable "enable_workers" {
  type        = bool
  default     = false
  description = "Opt in to SQS polling and processing for a bounded test session."
}
