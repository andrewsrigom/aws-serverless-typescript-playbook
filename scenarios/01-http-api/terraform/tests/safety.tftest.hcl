mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  target_account_id = "123456789012"
}

run "safe_defaults" {
  command = plan
  assert {
    condition     = aws_dynamodb_table.resources.on_demand_throughput[0].max_read_request_units == 10 && aws_dynamodb_table.resources.on_demand_throughput[0].max_write_request_units == 10
    error_message = "DynamoDB throughput must remain bounded."
  }
  assert {
    condition     = alltrue([for route in aws_apigatewayv2_route.this : route.authorization_type == "AWS_IAM"])
    error_message = "HTTP routes must require IAM by default."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "not-an-account" }
  expect_failures = [var.target_account_id]
}
