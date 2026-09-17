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
    condition     = var.target_account_id == "123456789012"
    error_message = "The target account must be explicit."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "not-an-account" }
  expect_failures = [var.target_account_id]
}
