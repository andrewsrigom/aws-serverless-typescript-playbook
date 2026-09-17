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

resource "aws_cloudwatch_metric_alarm" "health" {
  for_each            = var.enable_alarms ? toset(["Errors", "Throttles"]) : toset([])
  alarm_name          = "${var.name}-${lower(each.value)}"
  namespace           = "AWS/Lambda"
  metric_name         = each.value
  dimensions          = { FunctionName = aws_lambda_function.this.function_name }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_action_arns
}
