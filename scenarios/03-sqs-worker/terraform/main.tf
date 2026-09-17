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
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "03-sqs-worker", ManagedBy = "Terraform" }
  }
}

locals { name = "aws-playbook-worker-${var.environment}" }

resource "aws_dynamodb_table" "records" {
  name         = local.name
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

module "work" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = local.name
  visibility        = 90
}

module "worker" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-worker"
  artifact          = "${path.module}/../../../dist/03-sqs-worker/handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.records.name }
  statements        = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.records.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.work.arn] }]
  timeout           = 15
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn                   = module.work.arn
  function_name                      = module.worker.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  enabled                            = var.enable_workers
  scaling_config { maximum_concurrency = 2 }
}

output "queue_url" { value = module.work.url }

output "dlq_url" { value = module.work.dlq_url }

output "function_name" { value = module.worker.name }

output "table_name" { value = aws_dynamodb_table.records.name }

variable "enable_workers" {
  type        = bool
  default     = false
  description = "Opt in to SQS polling and processing for a bounded test session."
}
