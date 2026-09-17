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

variable "publishers" {
  type    = list(object({ service = string, source_arn = string, source_account = optional(string) }))
  default = []
}

locals {
  transport_deny = {
    Sid       = "DenyInsecureTransport"
    Effect    = "Deny"
    Principal = "*"
    Action    = "sqs:*"
    Condition = { Bool = { "aws:SecureTransport" = "false", "aws:PrincipalIsAWSService" = "false" } }
  }
}

resource "aws_sqs_queue_policy" "this" {
  queue_url = aws_sqs_queue.this.url
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(
    [merge(local.transport_deny, { Resource = aws_sqs_queue.this.arn })],
    [for publisher in var.publishers : {
      Effect    = "Allow", Principal = { Service = publisher.service }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.this.arn,
      Condition = merge({ ArnEquals = { "aws:SourceArn" = publisher.source_arn } }, publisher.source_account == null ? {} : { StringEquals = { "aws:SourceAccount" = publisher.source_account } })
    }]
  ) })
}

resource "aws_sqs_queue_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.url
  policy = jsonencode({ Version = "2012-10-17", Statement = concat(
    [merge(local.transport_deny, { Resource = aws_sqs_queue.dlq.arn })],
    [for publisher in var.publishers : {
      Effect    = "Allow", Principal = { Service = publisher.service }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.dlq.arn,
      Condition = merge({ ArnEquals = { "aws:SourceArn" = publisher.source_arn } }, publisher.source_account == null ? {} : { StringEquals = { "aws:SourceAccount" = publisher.source_account } })
    }]
  ) })
}
