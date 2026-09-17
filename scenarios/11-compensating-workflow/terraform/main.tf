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
    tags = { Project = "aws-serverless-typescript-playbook", Environment = var.environment, Scenario = "11-compensating-workflow", ManagedBy = "Terraform" }
  }
}


locals { name = "aws-playbook-saga-${var.environment}" }

resource "aws_dynamodb_table" "records" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  on_demand_throughput {
    max_read_request_units  = 10
    max_write_request_units = 10
  }
}

module "worker" {
  source            = "../../../terraform/modules/function"
  enable_alarms     = var.enable_alarms
  alarm_action_arns = var.alarm_action_arns
  name              = "${local.name}-worker"
  artifact          = "${path.module}/../../../dist/11-compensating-workflow/handler.zip"
  environment       = { TABLE_NAME = aws_dynamodb_table.records.name }
  statements        = [{ actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], resources = [aws_dynamodb_table.records.arn] }]
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.target_account_id]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:states:${var.region}:${var.target_account_id}:stateMachine:${local.name}"]
    }
  }
}

resource "aws_iam_role" "workflow" {
  name               = "${local.name}-workflow"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy" "workflow" {
  role   = aws_iam_role.workflow.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = [module.worker.arn] }] })
}

resource "aws_sfn_state_machine" "this" {
  name       = local.name
  role_arn   = aws_iam_role.workflow.arn
  type       = "STANDARD"
  definition = templatefile("${path.module}/../workflow.asl.json", { worker_arn = module.worker.arn })
  depends_on = [aws_iam_role_policy.workflow]
}

output "state_machine_arn" { value = aws_sfn_state_machine.this.arn }
output "table_name" { value = aws_dynamodb_table.records.name }
