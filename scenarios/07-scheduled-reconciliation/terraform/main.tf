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
provider "aws" { region = var.region }
locals { name = "aws-playbook-reconcile-${var.environment}" }
resource "aws_dynamodb_table" "records" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
resource "aws_dynamodb_table" "checkpoints" {
  name         = "${local.name}-checkpoints"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
module "worker" {
  source               = "../../../terraform/modules/function"
  name                 = "${local.name}-worker"
  artifact             = "${path.module}/../../../dist/07-scheduled-reconciliation/handler.zip"
  environment          = { TABLE_NAME = aws_dynamodb_table.records.name, CHECKPOINT_TABLE = aws_dynamodb_table.checkpoints.name }
  statements           = [{ actions = ["dynamodb:Scan", "dynamodb:UpdateItem"], resources = [aws_dynamodb_table.records.arn] }, { actions = ["dynamodb:GetItem", "dynamodb:PutItem"], resources = [aws_dynamodb_table.checkpoints.arn] }]
  timeout              = 60
  reserved_concurrency = 1
}
resource "aws_sqs_queue" "schedule_dlq" {
  name                      = "${local.name}-schedule-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "scheduler.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }, ArnEquals = { "aws:SourceArn" = aws_scheduler_schedule_group.this.arn } } }] })
}
data "aws_caller_identity" "current" {}
resource "aws_scheduler_schedule_group" "this" { name = local.name }
resource "aws_iam_role_policy" "scheduler" {
  role   = aws_iam_role.scheduler.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = "lambda:InvokeFunction", Resource = module.worker.arn }, { Effect = "Allow", Action = "sqs:SendMessage", Resource = aws_sqs_queue.schedule_dlq.arn }] })
}
resource "aws_scheduler_schedule" "this" {
  name                = local.name
  group_name          = aws_scheduler_schedule_group.this.name
  schedule_expression = "rate(5 minutes)"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = module.worker.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = "{}"
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 3
    }
    dead_letter_config { arn = aws_sqs_queue.schedule_dlq.arn }
  }
  depends_on = [aws_iam_role_policy.scheduler]
}
output "function_name" { value = module.worker.name }
output "table_name" { value = aws_dynamodb_table.records.name }
output "checkpoint_table_name" { value = aws_dynamodb_table.checkpoints.name }
output "dlq_url" { value = aws_sqs_queue.schedule_dlq.url }
