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
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "02-webhook-ingestion", ManagedBy = "Terraform" }
  }
}

locals { name = "aws-playbook-webhook-${var.environment}" }

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
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

module "work" {
  source            = "../../../terraform/modules/queue"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = local.name
  visibility        = 90
}

variable "secret_arn" {
  type        = string
  description = "Existing Secrets Manager secret ARN containing the raw signing secret; never put its value in Terraform."
  validation {
    condition     = can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", var.secret_arn))
    error_message = "Provide one complete Secrets Manager secret ARN without IAM wildcards."
  }
}

module "ingestion" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-ingestion"
  artifact          = "${path.module}/../../../dist/02-webhook-ingestion/handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.records.name, QUEUE_URL = module.work.url, SECRET_ARN = var.secret_arn }
  statements        = [{ actions = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], resources = [aws_dynamodb_table.records.arn] }, { actions = ["sqs:SendMessage"], resources = [module.work.arn] }, { actions = ["secretsmanager:GetSecretValue"], resources = [var.secret_arn] }]
  timeout           = 15
}

resource "aws_apigatewayv2_api" "webhook" {
  name          = "${local.name}-webhook"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "webhook" {
  api_id                 = aws_apigatewayv2_api.webhook.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.ingestion.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "webhook" {
  api_id             = aws_apigatewayv2_api.webhook.id
  route_key          = "POST /webhook"
  authorization_type = var.allow_public_webhook ? "NONE" : "AWS_IAM"
  target             = "integrations/${aws_apigatewayv2_integration.webhook.id}"
}

resource "aws_cloudwatch_log_group" "webhook" {
  name              = "/aws/apigateway/${local.name}-webhook"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "webhook" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.webhook.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status" })
  }
}

resource "aws_lambda_permission" "webhook" {
  action        = "lambda:InvokeFunction"
  function_name = module.ingestion.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/POST/webhook"
}

output "webhook_endpoint" { value = aws_apigatewayv2_api.webhook.api_endpoint }

output "queue_url" { value = module.work.url }

output "dlq_url" { value = module.work.dlq_url }

output "function_name" { value = module.ingestion.name }

output "table_name" { value = aws_dynamodb_table.records.name }

variable "allow_public_webhook" {
  type        = bool
  default     = false
  description = "Opt in to anonymous transport for external HMAC senders; API and Lambda charges still apply to invalid traffic."
}

output "public_webhook_enabled" { value = var.allow_public_webhook }
