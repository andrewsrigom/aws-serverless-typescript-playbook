terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.64.0" }
  }
}
variable "name" { type = string }
variable "visibility" { default = 90 }
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "this" {
  name                       = var.name
  visibility_timeout_seconds = var.visibility
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 5 })
}
resource "aws_sqs_queue_redrive_allow_policy" "this" {
  queue_url            = aws_sqs_queue.dlq.url
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.this.arn] })
}
output "arn" { value = aws_sqs_queue.this.arn }
output "url" { value = aws_sqs_queue.this.url }
output "dlq_arn" { value = aws_sqs_queue.dlq.arn }
output "dlq_url" { value = aws_sqs_queue.dlq.url }
