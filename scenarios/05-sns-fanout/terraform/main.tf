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
locals { name = "aws-playbook-fanout-${var.environment}" }
resource "aws_sns_topic" "events" { name = local.name }
module "publisher" {
  source      = "../../../terraform/modules/function"
  name        = "${local.name}-publisher"
  artifact    = "${path.module}/../../../dist/05-sns-fanout/publisher-handler.zip"
  environment = { TOPIC_ARN = aws_sns_topic.events.arn }
  statements  = [{ actions = ["sns:Publish"], resources = [aws_sns_topic.events.arn] }]
  timeout     = 15
}
resource "aws_dynamodb_table" "audit" {
  name         = "${local.name}-audit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
module "audit" {
  source     = "../../../terraform/modules/queue"
  name       = "${local.name}-audit"
  visibility = 90
}
module "audit_consumer" {
  source      = "../../../terraform/modules/function"
  name        = "${local.name}-audit"
  artifact    = "${path.module}/../../../dist/05-sns-fanout/consumer-handler.zip"
  environment = { TABLE_NAME = aws_dynamodb_table.audit.name }
  statements  = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.audit.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.audit.arn] }]
  timeout     = 15
}
resource "aws_lambda_event_source_mapping" "audit" {
  event_source_arn                   = module.audit.arn
  function_name                      = module.audit_consumer.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}
resource "aws_sns_topic_subscription" "audit" {
  topic_arn            = aws_sns_topic.events.arn
  protocol             = "sqs"
  endpoint             = module.audit.arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"
  filter_policy        = jsonencode({ kind = ["created", "updated"] })
  redrive_policy       = jsonencode({ deadLetterTargetArn = module.audit.dlq_arn })
}
resource "aws_sqs_queue_policy" "audit" {
  queue_url = module.audit.url
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = module.audit.arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } } }] })
}
resource "aws_sqs_queue_policy" "audit_dlq" {
  queue_url = module.audit.dlq_url
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = module.audit.dlq_arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } } }] })
}
output "audit_queue_url" { value = module.audit.url }
output "audit_dlq_url" { value = module.audit.dlq_url }
output "audit_table_name" { value = aws_dynamodb_table.audit.name }
resource "aws_dynamodb_table" "index" {
  name         = "${local.name}-index"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
module "index" {
  source     = "../../../terraform/modules/queue"
  name       = "${local.name}-index"
  visibility = 90
}
module "index_consumer" {
  source      = "../../../terraform/modules/function"
  name        = "${local.name}-index"
  artifact    = "${path.module}/../../../dist/05-sns-fanout/consumer-handler.zip"
  environment = { TABLE_NAME = aws_dynamodb_table.index.name }
  statements  = [{ actions = ["dynamodb:PutItem"], resources = [aws_dynamodb_table.index.arn] }, { actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], resources = [module.index.arn] }]
  timeout     = 15
}
resource "aws_lambda_event_source_mapping" "index" {
  event_source_arn                   = module.index.arn
  function_name                      = module.index_consumer.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}
resource "aws_sns_topic_subscription" "index" {
  topic_arn            = aws_sns_topic.events.arn
  protocol             = "sqs"
  endpoint             = module.index.arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"
  filter_policy        = jsonencode({ kind = ["created"] })
  redrive_policy       = jsonencode({ deadLetterTargetArn = module.index.dlq_arn })
}
resource "aws_sqs_queue_policy" "index" {
  queue_url = module.index.url
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = module.index.arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } } }] })
}
resource "aws_sqs_queue_policy" "index_dlq" {
  queue_url = module.index.dlq_url
  policy    = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = module.index.dlq_arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.events.arn } } }] })
}
output "index_queue_url" { value = module.index.url }
output "index_dlq_url" { value = module.index.dlq_url }
output "index_table_name" { value = aws_dynamodb_table.index.name }
output "publisher_function_name" { value = module.publisher.name }
output "topic_arn" { value = aws_sns_topic.events.arn }
