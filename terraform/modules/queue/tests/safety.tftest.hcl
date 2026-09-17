mock_provider "aws" { override_during = plan }

variables {
  name       = "local-safety-test"
  publishers = [{ service = "sns.amazonaws.com", source_arn = "arn:aws:sns:us-east-1:123456789012:fixture" }]
}

run "transport_and_publisher_scope" {
  command = plan
  assert {
    condition     = aws_sqs_queue.this.sqs_managed_sse_enabled && aws_sqs_queue.dlq.sqs_managed_sse_enabled
    error_message = "Queue and DLQ encryption must remain enabled."
  }
  assert {
    condition     = jsondecode(aws_sqs_queue_policy.this.policy).Statement[0].Effect == "Deny" && jsondecode(aws_sqs_queue_policy.this.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false" && jsondecode(aws_sqs_queue_policy.dlq.policy).Statement[0].Effect == "Deny"
    error_message = "Queue and DLQ must reject insecure transport."
  }
  assert {
    condition     = jsondecode(aws_sqs_queue_policy.this.policy).Statement[1].Condition.ArnEquals["aws:SourceArn"] == "arn:aws:sns:us-east-1:123456789012:fixture"
    error_message = "Service publishers must be scoped to an exact source ARN."
  }
}

override_resource {
  target          = aws_sqs_queue.this
  override_during = plan
  values = {
    arn = "arn:aws:sqs:us-east-1:123456789012:fixture-this"
    url = "https://sqs.us-east-1.amazonaws.com/123456789012/fixture-this"
  }
}

override_resource {
  target          = aws_sqs_queue.dlq
  override_during = plan
  values = {
    arn = "arn:aws:sqs:us-east-1:123456789012:fixture-dlq"
    url = "https://sqs.us-east-1.amazonaws.com/123456789012/fixture-dlq"
  }
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

run "bucket_publisher_account" {
  command = plan
  variables { publishers = [{ service = "s3.amazonaws.com", source_arn = "arn:aws:s3:::example-sandbox", source_account = "123456789012" }] }
  assert {
    condition     = jsondecode(aws_sqs_queue_policy.this.policy).Statement[1].Condition.StringEquals["aws:SourceAccount"] == "123456789012"
    error_message = "Bucket publishers must also match the intended account."
  }
}
