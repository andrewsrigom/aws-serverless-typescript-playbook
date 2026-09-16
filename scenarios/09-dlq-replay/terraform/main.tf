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
locals { name = "aws-playbook-replay-${var.environment}" }
module "work" {
  source     = "../../../terraform/modules/queue"
  name       = local.name
  visibility = 90
}
resource "aws_iam_policy" "replay" {
  name        = local.name
  description = "Attach explicitly to a dedicated operator role after reviewing queue scope."
  policy      = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage"], Resource = module.work.dlq_arn }, { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = module.work.arn }] })
}
output "source_queue_url" { value = module.work.dlq_url }
output "destination_queue_url" { value = module.work.url }
output "operator_policy_arn" { value = aws_iam_policy.replay.arn }
