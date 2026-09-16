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
locals { name = "aws-playbook-worker-${var.environment}" }
resource "aws_dynamodb_table" "records" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
module "work" {
  source     = "../../../terraform/modules/queue"
  name       = local.name
  visibility = 90
}
module "worker" {
  source      = "../../../terraform/modules/function"
  name        = "${local.name}-worker"
  artifact    = "${path.module}/../../../dist/03-sqs-worker/handler.zip"
  environment = { TABLE_NAME = aws_dynamodb_table.records.name }
  statements  = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.records.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.work.arn] }]
  timeout     = 15
}
resource "aws_lambda_event_source_mapping" "worker" {
  event_source_arn                   = module.work.arn
  function_name                      = module.worker.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}
output "queue_url" { value = module.work.url }
output "dlq_url" { value = module.work.dlq_url }
output "function_name" { value = module.worker.name }
output "table_name" { value = aws_dynamodb_table.records.name }
