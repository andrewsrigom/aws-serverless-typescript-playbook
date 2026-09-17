mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
}

variables { target_account_id = "123456789012" }

run "safe_defaults" {
  command = plan
  assert {
    condition     = aws_sfn_state_machine.this.type == "STANDARD"
    error_message = "Compensation requires durable standard execution history."
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.workflow) == 0
    error_message = "Workflow alarms require explicit opt-in."
  }
  assert {
    condition     = aws_dynamodb_table.records.on_demand_throughput[0].max_write_request_units == 10
    error_message = "Reservation capacity must be capped."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "invalid" }
  expect_failures = [var.target_account_id]
}
