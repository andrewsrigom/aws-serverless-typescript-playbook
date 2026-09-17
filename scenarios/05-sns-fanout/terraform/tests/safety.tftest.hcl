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
    condition     = aws_dynamodb_table.audit.on_demand_throughput[0].max_read_request_units == 10 && aws_dynamodb_table.audit.on_demand_throughput[0].max_write_request_units == 10
    error_message = "DynamoDB throughput must remain bounded."
  }
  assert {
    condition     = aws_dynamodb_table.index.on_demand_throughput[0].max_read_request_units == 10 && aws_dynamodb_table.index.on_demand_throughput[0].max_write_request_units == 10
    error_message = "DynamoDB throughput must remain bounded."
  }
  assert {
    condition     = !aws_lambda_event_source_mapping.audit.enabled && aws_lambda_event_source_mapping.audit.scaling_config[0].maximum_concurrency == 2
    error_message = "Workers must be disabled by default and bounded when enabled."
  }
  assert {
    condition     = !aws_lambda_event_source_mapping.index.enabled && aws_lambda_event_source_mapping.index.scaling_config[0].maximum_concurrency == 2
    error_message = "Workers must be disabled by default and bounded when enabled."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "not-an-account" }
  expect_failures = [var.target_account_id]
}
