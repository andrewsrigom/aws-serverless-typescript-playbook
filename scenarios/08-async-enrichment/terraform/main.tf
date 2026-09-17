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
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "08-async-enrichment", ManagedBy = "Terraform" }
  }
}

locals { name = "aws-playbook-enrichment-${var.environment}" }

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
  visibility        = 180
}

module "ingestion" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-ingestion"
  artifact          = "${path.module}/../../../dist/08-async-enrichment/ingestion-handler.zip"
  environment       = { QUEUE_URL = module.work.url }
  statements        = [{ actions = ["sqs:SendMessage"], resources = [module.work.arn] }]
  timeout           = 15
}

module "provider" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-provider"
  artifact          = "${path.module}/../../../dist/08-async-enrichment/provider-handler.zip"
  environment       = {}
  statements        = []
  timeout           = 15
}

resource "aws_apigatewayv2_api" "provider" {
  name          = "${local.name}-provider"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "provider" {
  api_id                 = aws_apigatewayv2_api.provider.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.provider.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "provider" {
  api_id             = aws_apigatewayv2_api.provider.id
  route_key          = "GET /classify/{id}"
  authorization_type = "AWS_IAM"
  target             = "integrations/${aws_apigatewayv2_integration.provider.id}"
}

resource "aws_cloudwatch_log_group" "provider" {
  name              = "/aws/apigateway/${local.name}-provider"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "provider" {
  api_id      = aws_apigatewayv2_api.provider.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.provider.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status" })
  }
}

resource "aws_lambda_permission" "provider" {
  action        = "lambda:InvokeFunction"
  function_name = module.provider.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.provider.execution_arn}/*/GET/classify/*"
}

output "provider_endpoint" { value = aws_apigatewayv2_api.provider.api_endpoint }

module "worker" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-worker"
  artifact          = "${path.module}/../../../dist/08-async-enrichment/worker-handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.records.name, PROVIDER_URL = aws_apigatewayv2_api.provider.api_endpoint }
  statements        = [{ actions = ["dynamodb:GetItem", "dynamodb:PutItem"], resources = [aws_dynamodb_table.records.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.work.arn] }, { actions = ["execute-api:Invoke"], resources = ["${aws_apigatewayv2_api.provider.execution_arn}/*/GET/classify/*"] }]
  timeout           = 30
}

resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn                   = module.work.arn
  function_name                      = module.worker.arn
  batch_size                         = 5
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  enabled                            = var.enable_workers
  scaling_config { maximum_concurrency = 2 }
}

output "queue_url" { value = module.work.url }

output "dlq_url" { value = module.work.dlq_url }

output "function_name" { value = module.worker.name }

output "table_name" { value = aws_dynamodb_table.records.name }

output "ingestion_function_name" { value = module.ingestion.name }

variable "enable_workers" {
  type        = bool
  default     = false
  description = "Opt in to SQS polling and processing for a bounded test session."
}
