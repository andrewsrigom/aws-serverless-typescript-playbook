mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  name        = "local-safety-test"
  artifact    = "../../../dist/01-http-api/handler.zip"
  environment = {}
  statements  = []
}

run "bounded_compute" {
  command = plan
  assert {
    condition     = aws_lambda_function.this.reserved_concurrent_executions == 2 && aws_lambda_function.this.memory_size == 256 && aws_cloudwatch_log_group.this.retention_in_days == 7
    error_message = "Compute and log retention must remain bounded."
  }
}

run "reject_unbounded_concurrency" {
  command = plan
  variables { reserved_concurrency = -1 }
  expect_failures = [var.reserved_concurrency]
}

run "alarms_opt_in" {
  command = plan
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.health) == 0
    error_message = "Default plans must not create billable alarms."
  }
}

run "alarms_enabled" {
  command = plan
  variables { enable_alarms = true }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.health) == 2
    error_message = "Explicit opt-in must create both health alarms."
  }
}
