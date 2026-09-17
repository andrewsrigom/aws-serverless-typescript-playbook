terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "= 6.64.0" }
  }
}

variable "name" { type = string }

variable "artifact" { type = string }

variable "environment" { type = map(string) }

variable "statements" { type = list(object({ actions = list(string), resources = list(string) })) }

variable "timeout" { default = 15 }

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 7
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "runtime" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
  dynamic "statement" {
    for_each = var.statements
    content {
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "this" {
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.runtime.json
}

resource "aws_lambda_function" "this" {
  function_name                  = var.name
  role                           = aws_iam_role.this.arn
  filename                       = var.artifact
  source_code_hash               = filebase64sha256(var.artifact)
  runtime                        = "nodejs24.x"
  handler                        = "index.handler"
  timeout                        = var.timeout
  memory_size                    = 256
  reserved_concurrent_executions = var.reserved_concurrency
  environment { variables = var.environment }
  depends_on = [aws_iam_role_policy.this, aws_cloudwatch_log_group.this]
}

output "arn" { value = aws_lambda_function.this.arn }

output "name" { value = aws_lambda_function.this.function_name }

output "invoke_arn" { value = aws_lambda_function.this.invoke_arn }

variable "reserved_concurrency" {
  type    = number
  default = 2
  validation {
    condition     = var.reserved_concurrency >= 0 && var.reserved_concurrency <= 10 && floor(var.reserved_concurrency) == var.reserved_concurrency
    error_message = "Use 0 (emergency stop) through 10 concurrent executions for this sandbox module."
  }
}
