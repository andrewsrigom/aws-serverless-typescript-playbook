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
    condition     = aws_dynamodb_table.records.on_demand_throughput[0].max_read_request_units == 10 && aws_dynamodb_table.records.on_demand_throughput[0].max_write_request_units == 10
    error_message = "DynamoDB throughput must remain bounded."
  }
  assert {
    condition     = aws_dynamodb_table.checkpoints.on_demand_throughput[0].max_read_request_units == 10 && aws_dynamodb_table.checkpoints.on_demand_throughput[0].max_write_request_units == 10
    error_message = "DynamoDB throughput must remain bounded."
  }
  assert {
    condition     = aws_scheduler_schedule.this.state == "DISABLED"
    error_message = "Recurring execution must require an explicit opt-in."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "not-an-account" }
  expect_failures = [var.target_account_id]
}
