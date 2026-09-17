mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
}

variables { target_account_id = "123456789012" }

run "safe_defaults" {
  command = plan
  assert {
    condition     = !aws_lambda_event_source_mapping.outbox.enabled && aws_lambda_event_source_mapping.outbox.maximum_retry_attempts == 3
    error_message = "Stream polling must remain opt-in with bounded retries."
  }
  assert {
    condition     = aws_dynamodb_table.outbox.stream_view_type == "KEYS_ONLY"
    error_message = "The stream should not expose full business payloads."
  }
  assert {
    condition     = aws_dynamodb_table.outbox.on_demand_throughput[0].max_write_request_units == 10
    error_message = "Outbox capacity must be capped."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "invalid" }
  expect_failures = [var.target_account_id]
}
