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
locals { name = "aws-playbook-http-${var.environment}" }
resource "aws_dynamodb_table" "resources" {
  name         = local.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
}
module "api" {
  source      = "../../../terraform/modules/function"
  name        = local.name
  artifact    = "${path.module}/../../../dist/01-http-api/handler.zip"
  environment = { TABLE_NAME = aws_dynamodb_table.resources.name }
  statements  = [{ actions = ["dynamodb:GetItem", "dynamodb:PutItem"], resources = [aws_dynamodb_table.resources.arn] }]
}
resource "aws_apigatewayv2_api" "this" {
  name          = local.name
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "this" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = module.api.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "this" {
  for_each           = toset(["POST /resources", "GET /resources/{id}"])
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.value
  authorization_type = "AWS_IAM"
  target             = "integrations/${aws_apigatewayv2_integration.this.id}"
}
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = 7
}
resource "aws_apigatewayv2_stage" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = jsonencode({ requestId = "$context.requestId", status = "$context.status", route = "$context.routeKey" })
  }
}
resource "aws_lambda_permission" "gateway" {
  action        = "lambda:InvokeFunction"
  function_name = module.api.name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/resources*"
}
output "endpoint" { value = aws_apigatewayv2_api.this.api_endpoint }
output "table_name" { value = aws_dynamodb_table.resources.name }
output "function_name" { value = module.api.name }
