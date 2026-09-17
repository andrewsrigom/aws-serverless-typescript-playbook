mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
}

variables { target_account_id = "123456789012" }

run "safe_defaults" {
  command = plan
  assert {
    condition     = !aws_lambda_event_source_mapping.uploads.enabled
    error_message = "S3 processing must be opt-in."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.uploads.block_public_policy && aws_s3_bucket_public_access_block.uploads.block_public_acls && aws_s3_bucket_public_access_block.uploads.ignore_public_acls && aws_s3_bucket_public_access_block.uploads.restrict_public_buckets
    error_message = "All public access must be blocked."
  }
  assert {
    condition     = aws_s3_bucket_versioning.uploads.versioning_configuration[0].status == "Enabled" && !aws_s3_bucket.uploads.force_destroy
    error_message = "Uploads need immutable version IDs and intentional data teardown."
  }
  assert {
    condition     = aws_dynamodb_table.results.on_demand_throughput[0].max_write_request_units == 10
    error_message = "Result capacity must be capped."
  }
}

run "reject_invalid_account" {
  command = plan
  variables { target_account_id = "invalid" }
  expect_failures = [var.target_account_id]
}
