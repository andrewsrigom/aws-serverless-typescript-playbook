variable "enable_alarms" {
  type        = bool
  default     = false
  description = "Opt in to billable CloudWatch alarms for this sandbox."
}

variable "alarm_action_arns" {
  type        = list(string)
  default     = []
  description = "Existing SNS topic ARNs; empty means console-only alarms."
  validation {
    condition     = alltrue([for arn in var.alarm_action_arns : can(regex("^arn:aws:sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+$", arn))])
    error_message = "Use existing SNS topic ARNs."
  }
}

locals {
  alarms = {
    backlog_age = { queue = aws_sqs_queue.this.name, metric = "ApproximateAgeOfOldestMessage", threshold = 300 }
    dlq_visible = { queue = aws_sqs_queue.dlq.name, metric = "ApproximateNumberOfMessagesVisible", threshold = 0 }
  }
}

resource "aws_cloudwatch_metric_alarm" "health" {
  for_each            = var.enable_alarms ? local.alarms : {}
  alarm_name          = "${var.name}-${each.key}"
  namespace           = "AWS/SQS"
  metric_name         = each.value.metric
  dimensions          = { QueueName = each.value.queue }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_action_arns
}
